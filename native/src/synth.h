// NiSH MarkSteady Piano: the real-time synth used by the native (ASIO) audio engine.
// A note-for-note port of the Web Audio instruments in src/audio.js, so both engines sound alike:
// piano, e-piano, organ, harpsichord, marimba, strings, a layered second instrument, the sustain pedal,
// play-along notes scheduled ahead, and the metronome click.
//
// Threading: post() may be called from any thread (stdin reader, MIDI callback). render() runs on the
// audio thread only, never allocates and never blocks: if a producer holds the queue lock, the events
// wait one buffer.
//
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <algorithm>
#include <initializer_list>
#include "bank.h"

namespace nish {

constexpr double kPi = 3.14159265358979323846;

enum Inst { PIANO = 0, EPIANO, ORGAN, HARPSICHORD, MARIMBA, STRINGS, NONE = -1 };

inline int instFromName(const char* s) {
  static const char* n[] = {"piano", "epiano", "organ", "harpsichord", "marimba", "strings"};
  for (int i = 0; i < 6; i++) if (std::strcmp(s, n[i]) == 0) return i;
  return NONE;
}

enum EvType : uint8_t { EV_USER_ON, EV_USER_OFF, EV_MIDI_ON, EV_MIDI_OFF, EV_PEDAL, EV_MIDI_PEDAL, EV_PLAY, EV_CANCEL_ACC, EV_CLICK, EV_ALL_OFF };

struct Event {
  EvType type;
  uint8_t midi, vel, flag;
  int64_t frame;   // absolute output frame when it should happen; <= now means "as soon as possible"
  int64_t dur;     // play: frames until release
};

// A tiny spin lock: producers wait for each other, the audio thread only ever tries.
class SpinLock {
  std::atomic_flag f = ATOMIC_FLAG_INIT;
 public:
  void lock() { while (f.test_and_set(std::memory_order_acquire)) {} }
  bool try_lock() { return !f.test_and_set(std::memory_order_acquire); }
  void unlock() { f.clear(std::memory_order_release); }
};

class Synth {
 public:
  static constexpr int MAXV = 256, QCAP = 4096, MAXCLICK = 16;

  explicit Synth(double sampleRate = 48000) { setRate(sampleRate); }

  void setRate(double sr) {
    rate = sr;
    noiseLen = (int)(sr * 0.05);
    for (auto& v : voices) v.on = false;
    for (auto& c : clicks) c.on = false;
    std::memset(userNotes, -1, sizeof(userNotes));
    std::memset(userNotes2, -1, sizeof(userNotes2));
    pedal = false;
  }
  double sampleRate() const { return rate; }
  int64_t now() const { return framesDone.load(std::memory_order_acquire); }

  // ---- settings, safe from any thread
  std::atomic<int> instrument{PIANO}, layer{NONE};
  std::atomic<float> userGain{0.42f}, accGain{0.29f}, metroGain{0.7f};
  std::atomic<bool> midiSound{true};
  // the sampled piano (Upright Piano KW): used for "piano" when a bank is loaded and samples are on;
  // otherwise the synth plays, which has no recorded silence at all
  std::atomic<const Bank*> bank{nullptr};
  std::atomic<bool> useSamples{true};
  std::atomic<float> sampleGain{0.6f};   // false: the keyboard has its own speakers, or "your notes" sound is off

  /** Queue an event. Returns false if the queue is full (should never happen in practice). */
  bool post(const Event& e) {
    qlock.lock();
    int next = (qhead + 1) % QCAP;
    bool ok = next != qtail;
    if (ok) { queue[qhead] = e; qhead = next; }
    qlock.unlock();
    return ok;
  }
  int64_t msToFrames(double ms) const { return (int64_t)std::llround(ms * rate / 1000.0); }

  /** Fill an interleaved stereo float buffer. Audio thread only. */
  void render(float* out, int n) {
    const int64_t t0 = framesDone.load(std::memory_order_relaxed);
    drain(t0, n);
    std::memset(out, 0, sizeof(float) * 2 * n);
    if (n > MAXBLOCK) n = MAXBLOCK;
    std::memset(busU, 0, sizeof(float) * n); std::memset(busUR, 0, sizeof(float) * n);
    std::memset(busA, 0, sizeof(float) * n); std::memset(busAR, 0, sizeof(float) * n);
    std::memset(busM, 0, sizeof(float) * n);
    for (auto& v : voices) if (v.on) renderVoice(v, t0, n);
    for (auto& c : clicks) if (c.on) renderClick(c, t0, n);
    const float gu = userGain.load(), ga = accGain.load(), gm = metroGain.load();
    const float norm = 1.0f / std::tanh(1.6f);
    for (int i = 0; i < n; i++) {
      // your notes and play-along go through a soft clipper with no look-ahead (a compressor would add delay)
      float l = std::tanh(1.6f * (busU[i] * gu + busA[i] * ga)) * norm;
      float r = std::tanh(1.6f * (busUR[i] * gu + busAR[i] * ga)) * norm;
      out[2 * i] = l + busM[i] * gm; out[2 * i + 1] = r + busM[i] * gm;
    }
    // pending events that were not due in this buffer stay queued for the next one
    framesDone.store(t0 + n, std::memory_order_release);
  }

  int activeVoices() const { int k = 0; for (auto& v : voices) k += v.on; return k; }

 private:
  static constexpr int MAXBLOCK = 8192, MAXPART = 8, PENDCAP = 1024;
  double rate = 48000;
  std::atomic<int64_t> framesDone{0};

  // ---------------------------------------------------------------- one-pole "setTargetAtTime" envelope
  struct Target {
    float v = 0, target = 0, k = 1; bool moving = false;
    void set(float tgt, float tau, double sr) { target = tgt; k = tau > 0 ? (float)std::exp(-1.0 / (tau * sr)) : 0.f; moving = true; }
    inline float tick() { if (moving) v = target + (v - target) * k; return v; }
  };
  // ---------------------------------------------------------------- RBJ biquad (Web Audio's formulas)
  struct Biquad {
    float b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0, z1 = 0, z2 = 0;
    void lowpass(double f, double sr) {   // Web Audio lowpass, default Q = 1 dB
      f = std::min(f, sr * 0.49);
      double w = 2 * kPi * f / sr, Q = std::pow(10.0, 1.0 / 20.0), al = std::sin(w) / (2 * Q), c = std::cos(w), a0 = 1 + al;
      b0 = (float)((1 - c) / 2 / a0); b1 = (float)((1 - c) / a0); b2 = b0; a1 = (float)(-2 * c / a0); a2 = (float)((1 - al) / a0);
    }
    void bandpass(double f, double Q, double sr) {
      f = std::min(f, sr * 0.49);
      double w = 2 * kPi * f / sr, al = std::sin(w) / (2 * Q), c = std::cos(w), a0 = 1 + al;
      b0 = (float)(al / a0); b1 = 0; b2 = (float)(-al / a0); a1 = (float)(-2 * c / a0); a2 = (float)((1 - al) / a0);
    }
    inline float tick(float x) { float y = b0 * x + z1; z1 = b1 * x - a1 * y + z2; z2 = b2 * x - a2 * y; return y; }
  };
  enum Wave : uint8_t { SINE, SAW, SQUARE, TRI };
  struct Partial {
    Wave wave = SINE; double phase = 0, inc = 0; Target g; int decayDelay = 0; bool decays = false; float tau = 0;
    double re = 1, im = 0, cr = 1, ci = 0;   // sine by rotation: no sin() per sample
  };
  struct Voice {
    bool on = false, user = false, held = false, sustained = false, released = false;
    int inst = PIANO; uint8_t midi = 0; float vel = 0;
    int64_t start = 0, end = 0, releaseAt = INT64_MAX, age = 0;
    float relTau = 0.16f;
    Target rel;                 // release gate (holds the layer level)
    // out gain: linear attack to peak, then an optional decay
    float peak = 0; int attack = 1; int decayStart = -1; float decayTau = 0; Target out;
    Biquad lp; bool lpGlide = false; float lpFrom = 0, lpTo = 0;
    Partial part[MAXPART]; int np = 0;
    // hammer / mallet noise burst
    bool noise = false; Biquad bp; Target ng; uint32_t seed = 1;
    // e-piano FM
    bool fm = false; double cPhase = 0, m1Phase = 0, m2Phase = 0, f0 = 0; Target idx1, idx2;
    int64_t pos = 0;            // samples since start
    // sampled piano
    bool sampled = false; const BankSample* smp = nullptr; const Bank* bk = nullptr;
    double spos = 0, step = 1; float sgain = 1; int ramp = 0; uint8_t vel7 = 0; int64_t heldFrom = 0;
  };
  struct Click { bool on = false; int64_t start = 0; double phase = 0, inc = 0; float peak = 0; int64_t pos = 0; };

  Voice voices[MAXV];
  Click clicks[MAXCLICK];
  int userNotes[128], userNotes2[128];   // voice index of the main and layered voice of a held user note
  bool pedal = false;
  int noiseLen = 2400;
  int64_t ageCounter = 0;
  float busU[MAXBLOCK], busUR[MAXBLOCK], busA[MAXBLOCK], busAR[MAXBLOCK], busM[MAXBLOCK];

  SpinLock qlock;
  Event queue[QCAP]; int qhead = 0, qtail = 0;
  Event pend[PENDCAP]; int npend = 0;   // events taken from the queue but due later (audio thread only)

  static double freqOf(int m) { return 440.0 * std::pow(2.0, (m - 69) / 12.0); }
  static float relTauOf(int inst) {
    switch (inst) { case ORGAN: return 0.03f; case EPIANO: return 0.12f; case HARPSICHORD: return 0.08f; case STRINGS: return 0.25f; case MARIMBA: return 0.06f; default: return 0.16f; }
  }

  // ---------------------------------------------------------------- events
  void drain(int64_t t0, int n) {
    if (qlock.try_lock()) {
      while (qtail != qhead && npend < PENDCAP) { pend[npend++] = queue[qtail]; qtail = (qtail + 1) % QCAP; }
      qlock.unlock();
    }
    const int64_t t1 = t0 + n;
    int keep = 0;
    for (int i = 0; i < npend; i++) {
      Event& e = pend[i];
      if (e.frame < t1) handle(e, std::max(e.frame, t0));
      else pend[keep++] = e;
    }
    npend = keep;
  }

  void handle(const Event& e, int64_t at) {
    switch (e.type) {
      case EV_MIDI_ON: if (!midiSound.load()) break; /* fall through */
      case EV_USER_ON: userOn(e.midi, e.vel, at); break;
      case EV_MIDI_OFF: case EV_USER_OFF: userOff(e.midi, at); break;
      case EV_MIDI_PEDAL: case EV_PEDAL: setPedal(e.flag != 0, at); break;
      case EV_PLAY: {
        int a = startVoice(instrument.load(), e.midi, e.vel ? e.vel : 80, at, false, 1.0f);
        int64_t dur = std::max<int64_t>(e.dur, (int64_t)(rate * 0.05));
        if (a >= 0) release(voices[a], at + dur, voices[a].relTau);
        int l = layer.load();
        if (l != NONE && l != instrument.load()) { int b = startVoice(l, e.midi, e.vel ? e.vel : 80, at, false, 0.7f); if (b >= 0) release(voices[b], at + dur, voices[b].relTau); }
        break;
      }
      case EV_CANCEL_ACC:
        for (auto& v : voices) if (v.on && !v.user) release(v, at, 0.012f);
        for (int i = 0; i < npend; i++) if (pend[i].type == EV_PLAY || pend[i].type == EV_CLICK) pend[i].type = EV_ALL_OFF, pend[i].flag = 1;
        break;
      case EV_CLICK: startClick(e.vel != 0, at); break;
      case EV_ALL_OFF:
        if (e.flag == 1) break;   // a cancelled play-along event
        for (auto& v : voices) if (v.on && v.user) release(v, at, 0.05f);
        std::memset(userNotes, -1, sizeof(userNotes)); std::memset(userNotes2, -1, sizeof(userNotes2));
        break;
    }
  }

  void userOn(int m, int vel, int64_t at) {
    // the same key again: the old note stops quickly, as in src/audio.js
    for (int* tab : {userNotes, userNotes2}) if (tab[m] >= 0) { Voice& o = voices[tab[m]]; if (o.on && o.midi == m && o.user) release(o, at, 0.03f); tab[m] = -1; }
    for (auto& o : voices) if (o.on && o.user && o.sustained && o.midi == m) { o.sustained = false; release(o, at, 0.03f); }
    int held = 0; int64_t oldest = INT64_MAX; int oldestM = -1;
    for (int k = 0; k < 128; k++) if (userNotes[k] >= 0) { held++; if (voices[userNotes[k]].age < oldest) { oldest = voices[userNotes[k]].age; oldestM = k; } }
    if (held > 40 && oldestM >= 0) { release(voices[userNotes[oldestM]], at, 0.05f); if (userNotes2[oldestM] >= 0) release(voices[userNotes2[oldestM]], at, 0.05f); userNotes[oldestM] = userNotes2[oldestM] = -1; }
    int a = startVoice(instrument.load(), m, vel ? vel : 90, at, true, 1.0f);
    userNotes[m] = a;
    int l = layer.load();
    userNotes2[m] = (l != NONE && l != instrument.load()) ? startVoice(l, m, vel ? vel : 90, at, true, 0.7f) : -1;
  }
  void userOff(int m, int64_t at) {
    for (int* tab : {userNotes, userNotes2}) {
      int i = tab[m];
      if (i < 0) continue;
      Voice& v = voices[i];
      tab[m] = -1;
      if (!v.on || v.midi != m || !v.user) continue;
      v.held = false;
      if (pedal) v.sustained = true; else { release(v, at, v.relTau); releaseSample(v, at); }
    }
  }
  void setPedal(bool down, int64_t at) {
    pedal = down;
    if (!down) for (auto& v : voices) if (v.on && v.user && v.sustained && !v.held) { v.sustained = false; release(v, at, v.relTau * 1.4f); releaseSample(v, at); }
  }
  void release(Voice& v, int64_t at, float tau) {
    if (v.released && v.releaseAt <= at) return;
    v.released = true; v.releaseAt = at; v.relTau = tau;
    v.end = std::min(v.end, at + (int64_t)(tau * 9 * rate) + 1);
  }

  int freeVoice() {
    int best = -1; int64_t bestAge = INT64_MAX;
    for (int i = 0; i < MAXV; i++) { if (!voices[i].on) return i; int64_t a = voices[i].age - (voices[i].released ? (int64_t)1 << 40 : 0); if (a < bestAge) { bestAge = a; best = i; } }
    return best;   // steal the oldest, preferring released voices
  }

  void addPartial(Voice& v, Wave w, double fr, float g, float decayTau, double detuneCents = 0) {
    if (v.np >= MAXPART) return;
    Partial& p = v.part[v.np++];
    if (detuneCents) fr *= std::pow(2.0, detuneCents / 1200.0);
    p.wave = w; p.phase = 0; p.inc = fr / rate; p.g.v = g; p.g.moving = false;
    p.re = 1; p.im = 0; p.cr = std::cos(2 * kPi * p.inc); p.ci = std::sin(2 * kPi * p.inc);
    p.decays = decayTau > 0; p.tau = decayTau; p.decayDelay = (int)(0.01 * rate);
  }

  int startVoice(int inst, int m, int vel, int64_t at, bool user, float level) {
    int i = freeVoice();
    if (i < 0) return -1;
    Voice& v = voices[i];
    v = Voice();
    v.on = true; v.user = user; v.held = user; v.inst = inst; v.midi = (uint8_t)m; v.start = at; v.age = ++ageCounter;
    v.relTau = relTauOf(inst); v.rel.v = level; v.seed = 0x9e3779b9u ^ (uint32_t)(m * 2654435761u) ^ (uint32_t)ageCounter;
    const double f = freqOf(m), sr = rate;
    const float vv = std::max(0.12f, std::min(1.0f, vel / 127.0f));
    if (inst == PIANO && useSamples.load()) {
      const Bank* bk = bank.load(std::memory_order_acquire);
      const BankRegion* r = bk ? bk->find(m, vel, false) : nullptr;
      if (r && startSampled(v, *bk, *r, m, vel, at, level)) return i;
    }
    const float reg = (m - 21) / 87.0f;
    double endSec = 6;
    auto setNoise = [&](double bf, double Q, float g, float tau) { v.noise = true; v.bp.bandpass(bf, Q, sr); v.ng.v = g; v.ng.set(0.0001f, tau, sr); };
    switch (inst) {
      case MARIMBA: {
        v.lp.lowpass(std::min(7000.0, f * 6 + 800), sr);
        float dec = 0.5f - 0.38f * reg;
        v.peak = 0.55f * (0.4f + 0.6f * vv); v.attack = (int)(0.002 * sr);
        addPartial(v, SINE, f, 1, dec); addPartial(v, SINE, f * 3.97, 0.35f, dec * 0.35f); addPartial(v, SINE, f * 9.9, 0.08f, dec * 0.12f);
        setNoise(std::min(4000.0, f * 2 + 500), 1.2, 0.1f * vv, 0.01f);
        endSec = 2.5; break;
      }
      case EPIANO: {
        v.lp.lowpass(std::min(9000.0, f * 8 + 1200), sr);
        v.peak = 0.5f * vv; v.attack = (int)(0.006 * sr); v.decayStart = (int)(0.05 * sr); v.decayTau = 1.4f;
        v.fm = true; v.f0 = f;
        v.idx1.v = (float)(f * 1.2 * vv); v.idx1.set((float)(f * 0.05), 0.12f, sr);
        v.idx2.v = (float)(f * 0.5); v.idx2.set((float)(f * 0.1), 0.5f, sr);
        endSec = 7; break;
      }
      case HARPSICHORD: {
        v.lpGlide = true; v.lpFrom = (float)std::min(14000.0, f * 14 + 2000); v.lpTo = (float)std::min(8000.0, f * 5 + 800); v.lp.lowpass(v.lpFrom, sr);
        v.peak = 0.28f * (0.5f + 0.5f * vv); v.attack = (int)(0.002 * sr);
        addPartial(v, SAW, f, 0.6f, 1.1f - 0.5f * reg); addPartial(v, SQUARE, f * 2, 0.12f, 0.4f);
        endSec = 3; break;
      }
      case STRINGS: {
        v.lp.lowpass(std::min(6000.0, f * 4 + 900), sr);
        v.peak = 0.16f * (0.5f + 0.5f * vv); v.attack = (int)(0.18 * sr);
        addPartial(v, SAW, f, 0.5f, 0, -7); addPartial(v, SAW, f, 0.5f, 0, 7); addPartial(v, TRI, f / 2, 0.2f, 0);
        endSec = 60; break;
      }
      case ORGAN: {
        v.lp.lowpass(7000, sr);
        v.peak = 0.32f * vv + 0.08f; v.attack = (int)(0.012 * sr);
        const float hs[5][2] = {{0.5f, 0.3f}, {1, 0.5f}, {2, 0.3f}, {3, 0.16f}, {4, 0.1f}};
        for (auto& h : hs) addPartial(v, SINE, f * h[0], h[1], 0);
        endSec = 60; break;
      }
      default: {   // piano: partials with slight inharmonicity, upper ones die faster, low notes ring longer
        const float base = 5.2f - 3.4f * reg;
        v.lp.lowpass(std::min(12000.0, f * (3 + vv * 9) + 600), sr);
        v.peak = 0.5f * (0.35f + 0.65f * vv); v.attack = (int)(0.004 * sr);
        const double B = 0.00012 * (1 + 4 * reg * reg);
        const float pg[6] = {0.9f, 0.5f, 0.3f, 0.17f, 0.09f, 0.05f};
        for (int k = 1; k <= 6; k++) {
          double fk = f * k * std::sqrt(1 + B * k * k);
          if (fk > 14000) continue;
          addPartial(v, SINE, fk, pg[k - 1] * (k > 2 ? (0.4f + 0.6f * vv) : 1.0f), base / std::pow((float)k, 0.7f) * 0.55f);
        }
        addPartial(v, SINE, f * 1.0015, 0.5f, base * 0.5f);   // second string, slightly out of tune
        setNoise(std::min(6000.0, f * 3 + 800), 0.8, 0.16f * vv * vv, 0.012f);
        endSec = 4 + base; break;
      }
    }
    if (v.attack < 1) v.attack = 1;
    v.out.v = 0.0001f;
    v.end = at + (int64_t)(endSec * sr);
    return i;
  }

  static float velGain(int vel, float veltrack) {
    // SFZ amp_veltrack: 100% follows (velocity/127)^2, 0% ignores velocity
    const float x = (float)vel / 127.0f, k = std::max(0.0f, std::min(100.0f, veltrack)) / 100.0f;
    return (1 - k) + k * x * x;
  }
  bool startSampled(Voice& v, const Bank& bk, const BankRegion& r, int m, int vel, int64_t at, float level) {
    const BankSample& s = bk.samples[r.sample];
    if (s.frames < 4) return false;
    v.sampled = true; v.smp = &s; v.bk = &bk; v.spos = 0; v.vel7 = (uint8_t)vel; v.heldFrom = at;
    v.step = std::pow(2.0, ((m - r.key) * 100.0 + r.tune) / 1200.0) * s.rate / rate;
    v.sgain = std::pow(10.0f, r.gainDb / 20.0f) * velGain(vel, r.veltrack) * sampleGain.load();
    v.ramp = std::max(1, (int)(0.0005 * rate));   // 0.5 ms: no click, no audible delay
    v.relTau = std::max(0.02f, r.releaseSec / 4.0f);
    v.rel.v = level;
    const bool loops = s.loopStart >= 0 && s.loopEnd > s.loopStart + 4;
    v.end = loops ? at + (int64_t)(600 * rate) : at + (int64_t)((double)(s.frames - 2) / v.step) + 1;
    return true;
  }
  // key up on a sampled note: the bank's release sample (damper and key noise), quieter the longer the key was held
  void releaseSample(const Voice& v, int64_t at) {
    if (!v.sampled || !v.bk) return;
    // copy first: when every voice is busy, the new one may reuse this very voice
    const Bank* bk = v.bk; const int m = v.midi, vel = v.vel7; const bool user = v.user; const int64_t heldFrom = v.heldFrom;
    const BankRegion* r = bk->find(m, vel, true);
    if (!r) return;
    int i = freeVoice();
    if (i < 0) return;
    Voice& n = voices[i];
    n = Voice();
    n.on = true; n.user = user; n.inst = PIANO; n.midi = (uint8_t)m; n.start = at; n.age = ++ageCounter; n.released = false;
    if (!startSampled(n, *bk, *r, m, vel, at, 1.0f)) { n.on = false; return; }
    const double held = std::max<int64_t>(0, at - heldFrom) / rate;
    n.sgain *= std::pow(10.0f, (float)(-r->rtDecay * held) / 20.0f);
    n.held = false;
  }
  inline float tap(const BankSample& s, const int16_t* pcm, int64_t i, int c) const {
    if (s.loopStart >= 0 && s.loopEnd > s.loopStart + 4) { const int64_t len = s.loopEnd - s.loopStart; while (i >= s.loopEnd) i -= len; }
    if (i < 0 || i >= s.frames) return 0.f;
    return pcm[s.offset + i * s.channels + (c < s.channels ? c : 0)] * (1.0f / 32768.0f);
  }
  static inline float hermite(float xm1, float x0, float x1, float x2, float t) {
    const float c = (x1 - xm1) * 0.5f, v = x0 - x1, w = c + v, a = w + v + (x2 - x0) * 0.5f, b = w + a;
    return (((a * t) - b) * t + c) * t + x0;
  }
  void renderSampled(Voice& v, int64_t t0, int n) {
    float* L = v.user ? busU : busA; float* R = v.user ? busUR : busAR;
    const BankSample& s = *v.smp; const int16_t* pcm = v.bk->pcm.data();
    const bool loops = s.loopStart >= 0 && s.loopEnd > s.loopStart + 4;
    const double sr = rate;
    int i0 = (int)std::max<int64_t>(0, v.start - t0);
    for (int i = i0; i < n; i++) {
      const int64_t fr = t0 + i;
      if (fr >= v.end) { v.on = false; return; }
      if (v.released && fr >= v.releaseAt && (fr == v.releaseAt || !v.rel.moving)) v.rel.set(0, v.relTau, sr);
      const int64_t p = v.pos++;
      double sp = v.spos;
      if (loops) { const double len = (double)(s.loopEnd - s.loopStart); while (sp >= s.loopEnd) sp -= len; v.spos = sp; }
      else if (sp >= s.frames - 2) { v.on = false; return; }
      const int64_t k = (int64_t)sp; const float t = (float)(sp - k);
      float g = v.sgain * v.rel.tick();
      if (p < v.ramp) g *= (float)(p + 1) / (float)v.ramp;
      const float l = hermite(tap(s, pcm, k - 1, 0), tap(s, pcm, k, 0), tap(s, pcm, k + 1, 0), tap(s, pcm, k + 2, 0), t);
      const float r = s.channels > 1 ? hermite(tap(s, pcm, k - 1, 1), tap(s, pcm, k, 1), tap(s, pcm, k + 1, 1), tap(s, pcm, k + 2, 1), t) : l;
      L[i] += l * g; R[i] += r * g;
      v.spos += v.step;
    }
  }

  static inline float polyblep(double t, double dt) {
    if (t < dt) { t /= dt; return (float)(t + t - t * t - 1.0); }
    if (t > 1.0 - dt) { t = (t - 1.0) / dt; return (float)(t * t + t + t + 1.0); }
    return 0.f;
  }
  static inline float osc(Partial& p) {
    double t = p.phase, dt = p.inc; float y;
    switch (p.wave) {
      case SAW: y = (float)(2.0 * t - 1.0) - polyblep(t, dt); break;
      case SQUARE: { y = t < 0.5 ? 1.f : -1.f; y += polyblep(t, dt); double t2 = t + 0.5; if (t2 >= 1) t2 -= 1; y -= polyblep(t2, dt); break; }
      case TRI: y = (float)(t < 0.5 ? 4 * t - 1 : 3 - 4 * t); break;
      default: {
        y = (float)p.im;
        const double r = p.re * p.cr - p.im * p.ci; p.im = p.re * p.ci + p.im * p.cr; p.re = r;
        return y;
      }
    }
    p.phase += dt; if (p.phase >= 1) p.phase -= 1;
    return y;
  }
  inline float noiseSample(Voice& v) { v.seed = v.seed * 1664525u + 1013904223u; return (float)((v.seed >> 8) * (1.0 / 8388608.0) - 1.0); }

  void renderVoice(Voice& v, int64_t t0, int n) {
    if (v.sampled) { renderSampled(v, t0, n); return; }
    float* bus = v.user ? busU : busA; float* busR = v.user ? busUR : busAR;
    const double sr = rate;
    int i0 = (int)std::max<int64_t>(0, v.start - t0);
    for (int i = i0; i < n; i++) {
      const int64_t fr = t0 + i;
      if (fr >= v.end) { v.on = false; return; }
      if (v.released && fr == v.releaseAt) v.rel.set(0, v.relTau, sr);
      else if (v.released && fr > v.releaseAt && !v.rel.moving) v.rel.set(0, v.relTau, sr);
      const int64_t p = v.pos++;
      // out gain: linear attack, then optional decay
      float og;
      if (p < v.attack) og = 0.0001f + (v.peak - 0.0001f) * (float)(p + 1) / (float)v.attack;
      else { if (p == v.attack) { v.out.v = v.peak; v.out.moving = false; } if (v.decayStart >= 0 && p == v.decayStart) v.out.set(0.0001f, v.decayTau, sr); og = v.out.tick(); }
      if (v.lpGlide && (p & 31) == 0) v.lp.lowpass(v.lpTo + (v.lpFrom - v.lpTo) * std::exp(-(double)p / sr / 0.08), sr);
      float s = 0;
      for (int k = 0; k < v.np; k++) {
        Partial& q = v.part[k];
        if (q.decays && p == q.decayDelay) q.g.set(0.0001f, q.tau, sr);
        s += osc(q) * q.g.tick();
      }
      if (v.fm) {
        const double m1 = std::sin(2 * kPi * v.m1Phase), m2 = std::sin(2 * kPi * v.m2Phase);
        const double fi = v.f0 + m1 * v.idx1.tick() + m2 * v.idx2.tick();
        s += (float)std::sin(2 * kPi * v.cPhase);
        v.cPhase += fi / sr; v.cPhase -= std::floor(v.cPhase);
        v.m1Phase += v.f0 * 14 / sr; if (v.m1Phase >= 1) v.m1Phase -= 1;
        v.m2Phase += v.f0 / sr; if (v.m2Phase >= 1) v.m2Phase -= 1;
      }
      if (v.noise && p < noiseLen) s += v.bp.tick(noiseSample(v)) * v.ng.tick();
      const float y = v.lp.tick(s * og) * v.rel.tick();
      bus[i] += y; busR[i] += y;
    }
  }

  void startClick(bool accent, int64_t at) {
    int i = 0; for (; i < MAXCLICK; i++) if (!clicks[i].on) break;
    if (i == MAXCLICK) i = 0;
    Click& c = clicks[i];
    c.on = true; c.start = at; c.phase = 0; c.inc = (accent ? 1760.0 : 1175.0) / rate; c.peak = accent ? 0.35f : 0.22f; c.pos = 0;
  }
  void renderClick(Click& c, int64_t t0, int n) {
    const int att = std::max(1, (int)(0.002 * rate)), dec = (int)(0.045 * rate), stop = (int)(0.06 * rate);
    int i0 = (int)std::max<int64_t>(0, c.start - t0);
    for (int i = i0; i < n; i++) {
      const int64_t p = c.pos++;
      if (p >= stop) { c.on = false; return; }
      float g;
      if (p < att) g = 0.0001f + (c.peak - 0.0001f) * (float)p / att;
      else if (p < dec) g = c.peak * std::pow(0.0001f / c.peak, (float)(p - att) / (float)(dec - att));
      else g = 0.0001f;
      float y = c.phase < 0.5 ? 1.f : -1.f;
      c.phase += c.inc; if (c.phase >= 1) c.phase -= 1;
      busM[i] += y * g;
    }
  }
};

}  // namespace nish
