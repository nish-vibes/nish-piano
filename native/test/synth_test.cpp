// Offline checks of the native synth: timing, levels, pedal, layering, cancel, and a WAV to listen to.
#include "../src/synth.h"
#include <cstdio>
#include <vector>
#include <string>
#include <ctime>
using namespace nish;
static int fails = 0;
#define CHECK(c, msg) do { if (c) printf("pass  %s\n", msg); else { printf("FAIL  %s\n", msg); fails++; } } while (0)

static std::vector<float> run(Synth& s, int frames, int block) {
  std::vector<float> out(frames * 2);
  for (int i = 0; i < frames; i += block) s.render(&out[i * 2], std::min(block, frames - i));
  return out;
}
static int firstSound(const std::vector<float>& o, float thr = 1e-4f) { for (size_t i = 0; i < o.size() / 2; i++) if (std::fabs(o[2 * i]) > thr) return (int)i; return -1; }
static float peak(const std::vector<float>& o, int a, int b) { float p = 0; for (int i = a; i < b && i < (int)o.size() / 2; i++) p = std::max(p, std::fabs(o[2 * i])); return p; }
static bool finite(const std::vector<float>& o) { for (float x : o) if (!std::isfinite(x)) return false; return true; }
static void wav(const char* path, const std::vector<float>& o, int sr) {
  FILE* f = fopen(path, "wb"); if (!f) return; int n = (int)o.size(); int bytes = n * 2;
  auto w32 = [&](uint32_t v) { fwrite(&v, 4, 1, f); }; auto w16 = [&](uint16_t v) { fwrite(&v, 2, 1, f); };
  fwrite("RIFF", 1, 4, f); w32(36 + bytes); fwrite("WAVEfmt ", 1, 8, f); w32(16); w16(1); w16(2); w32(sr); w32(sr * 4); w16(4); w16(16);
  fwrite("data", 1, 4, f); w32(bytes);
  for (float x : o) { int v = (int)std::lround(std::max(-1.f, std::min(1.f, x)) * 32767); w16((uint16_t)(int16_t)v); }
  fclose(f);
}

int main() {
  const int SR = 48000, B = 32;
  {
    Synth s(SR);
    s.post({EV_USER_ON, 60, 100, 0, 0, 0});
    auto o = run(s, SR / 10, B);
    int f = firstSound(o);
    printf("      first sound at frame %d (%.3f ms)\n", f, f * 1000.0 / SR);
    CHECK(f >= 0 && f < 4, "a key sounds within the first buffer, no added delay");
    CHECK(peak(o, 0, SR / 10) > 0.05f, "piano note is clearly audible");
  }
  {
    Synth s(SR);
    run(s, 4800, B);
    s.post({EV_PLAY, 64, 90, 0, s.now() + s.msToFrames(50), s.msToFrames(300)});
    auto o = run(s, SR / 2, B);
    int f = firstSound(o);
    printf("      scheduled note starts at %.2f ms after request (want 50)\n", f * 1000.0 / SR);
    CHECK(f >= 2400 && f <= 2403, "play-along notes start on the scheduled sample");
  }
  {
    Synth s(SR);
    for (int inst = 0; inst < 6; inst++) {
      s.instrument = inst;
      s.post({EV_USER_ON, (uint8_t)(48 + inst * 5), 100, 0, 0, 0});
      auto o = run(s, SR / 4, 64);
      s.post({EV_USER_OFF, (uint8_t)(48 + inst * 5), 0, 0, 0, 0});
      run(s, SR * 3, 64);
      char m[96]; snprintf(m, sizeof m, "instrument %d sounds, stays finite and below clipping", inst);
      CHECK(finite(o) && peak(o, 0, SR / 4) > 0.01f && peak(o, 0, SR / 4) <= 1.0f, m);
    }
    CHECK(s.activeVoices() == 0, "all voices end after release");
  }
  {
    Synth s(SR);
    s.post({EV_PEDAL, 0, 0, 1, 0, 0});
    s.post({EV_USER_ON, 60, 100, 0, 0, 0});
    run(s, SR / 10, B);
    s.post({EV_USER_OFF, 60, 0, 0, 0, 0});
    auto held = run(s, SR, B);
    CHECK(peak(held, SR - 4800, SR) > 0.005f, "sustain pedal keeps a released key ringing");
    s.post({EV_PEDAL, 0, 0, 0, 0, 0});
    run(s, SR * 3, B);
    CHECK(s.activeVoices() == 0, "pedal up releases the sustained notes");
  }
  {
    Synth s(SR);
    s.layer = STRINGS;
    s.post({EV_USER_ON, 60, 100, 0, 0, 0});
    run(s, 256, B);
    CHECK(s.activeVoices() == 2, "a layered instrument adds a second voice per key");
    s.post({EV_USER_OFF, 60, 0, 0, 0, 0});
    run(s, SR * 3, B);
    CHECK(s.activeVoices() == 0, "both layered voices end");
  }
  {
    Synth s(SR);
    for (int k = 0; k < 20; k++) s.post({EV_PLAY, (uint8_t)(50 + k), 80, 0, s.now() + s.msToFrames(100 + k * 10), s.msToFrames(2000)});
    run(s, 4800, B);
    s.post({EV_CANCEL_ACC, 0, 0, 0, 0, 0});
    auto o = run(s, SR, B);
    CHECK(peak(o, 4800, SR) < 1e-3f, "stopping play-along also drops notes that were still waiting");
  }
  {
    Synth s(SR);
    s.midiSound = false;
    s.post({EV_MIDI_ON, 60, 100, 0, 0, 0});
    auto o = run(s, 4800, B);
    CHECK(peak(o, 0, 4800) == 0, "keys from a piano with its own speakers stay silent when muted");
  }
  {
    Synth s(SR);
    s.post({EV_CLICK, 0, 1, 0, s.now() + s.msToFrames(10), 0});
    auto o = run(s, 4800, B);
    int f = firstSound(o);
    CHECK(f >= 480 && f <= 483 && peak(o, 0, 4800) > 0.1f, "metronome click lands on its sample");
  }
  {
    // stress: a full-arm chord on every key with pedal, at the smallest buffer, timed
    Synth s(SR);
    s.post({EV_PEDAL, 0, 0, 1, 0, 0});
    for (int m = 21; m <= 108; m++) s.post({EV_USER_ON, (uint8_t)m, 110, 0, 0, 0});
    std::vector<float> buf(32 * 2);
    auto t0 = std::clock();
    int blocks = SR / 32;   // one second of audio
    for (int b = 0; b < blocks; b++) s.render(buf.data(), 32);
    double cpu = double(std::clock() - t0) / CLOCKS_PER_SEC;
    printf("      88 sustained notes: %.0f%% of one core at 32 frames (%d voices)\n", cpu * 100, s.activeVoices());
    CHECK(cpu < 1.0, "88 sustained notes render faster than real time");
  }
  {
    // demo file: a short phrase with pedal, each instrument
    Synth s(SR);
    std::vector<float> all;
    const int mel[] = {60, 64, 67, 72, 67, 64};
    for (int inst = 0; inst < 6; inst++) {
      s.instrument = inst;
      for (int k = 0; k < 6; k++) s.post({EV_PLAY, (uint8_t)mel[k], 90, 0, s.now() + s.msToFrames(k * 200), s.msToFrames(180)});
      auto o = run(s, (int)(SR * 1.6), 128);
      all.insert(all.end(), o.begin(), o.end());
    }
    wav("nish_synth_demo.wav", all, SR);
    CHECK(finite(all), "demo phrase renders cleanly (wrote nish_synth_demo.wav)");
  }
  printf(fails ? "\n%d check(s) failed\n" : "\nAll synth checks passed\n", fails);
  return fails ? 1 : 0;
}
