// Offline rendering of a whole piece, for the video export: every note exactly on its sample, with the same
// instrument, piano samples and pedal as live playing, much faster than real time.
//
// Input file (UTF-8 text, one item per line):
//   out <path of the WAV to write>
//   rate <Hz>                 default 48000
//   gain <linear>             your-notes bus gain (volume already applied)
//   tail <seconds>            extra time after the last note ends, default 3
//   n <startSec> <durSec> <midi> <velocity>
//   p <sec> <0|1>             sustain pedal
// Output: 16-bit stereo PCM WAV.
//
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>
#include "bank.h"
#include "synth.h"

namespace nish {

struct RenderSettings { int instrument; int layer; bool useSamples; const Bank* bank; };
struct RenderResult { bool ok = false; std::string error; double seconds = 0; int notes = 0; };

inline RenderResult renderFile(const std::string& inPath, const RenderSettings& rs) {
  RenderResult res;
  std::FILE* f = openUtf8(inPath, "rb");
  if (!f) { res.error = "Cannot read the note list"; return res; }
  std::string out; double rate = 48000, gain = 0.42, tail = 3;
  struct Ev { double t; int kind; int midi; int vel; };   // kind: 0 pedal up, 1 off, 2 pedal down, 3 on (this order at equal times)
  std::vector<Ev> evs;
  char line[2048];
  double last = 0;
  while (std::fgets(line, sizeof line, f)) {
    if (std::strncmp(line, "out ", 4) == 0) { out = line + 4; while (!out.empty() && (out.back() == '\n' || out.back() == '\r')) out.pop_back(); }
    else if (std::strncmp(line, "rate ", 5) == 0) rate = std::atof(line + 5);
    else if (std::strncmp(line, "gain ", 5) == 0) gain = std::atof(line + 5);
    else if (std::strncmp(line, "tail ", 5) == 0) tail = std::atof(line + 5);
    else if (line[0] == 'n' && line[1] == ' ') {
      double st = 0, du = 0; int m = 0, v = 80;
      if (std::sscanf(line + 2, "%lf %lf %d %d", &st, &du, &m, &v) == 4 && m >= 0 && m < 128) {
        st = std::max(0.0, st); du = std::max(0.03, du);
        evs.push_back({st, 3, m, std::max(1, std::min(127, v))}); evs.push_back({st + du, 1, m, 0});
        last = std::max(last, st + du); res.notes++;
      }
    } else if (line[0] == 'p' && line[1] == ' ') {
      double t = 0; int d = 0;
      if (std::sscanf(line + 2, "%lf %d", &t, &d) == 2) { evs.push_back({std::max(0.0, t), d ? 2 : 0, 0, 0}); last = std::max(last, t); }
    }
  }
  std::fclose(f);
  if (out.empty()) { res.error = "No output path"; return res; }
  if (rate < 8000 || rate > 192000) rate = 48000;
  std::stable_sort(evs.begin(), evs.end(), [](const Ev& a, const Ev& b) { return a.t < b.t || (a.t == b.t && a.kind < b.kind); });
  // a key struck again before its earlier note ended: the earlier note's key-up must not cut the new one
  std::vector<Ev> clean; clean.reserve(evs.size());
  int down[128] = {0};
  for (const auto& e : evs) {
    if (e.kind == 3) { down[e.midi]++; clean.push_back(e); }
    else if (e.kind == 1) { if (down[e.midi] > 0 && --down[e.midi] == 0) clean.push_back(e); }
    else clean.push_back(e);
  }

  auto sp = std::make_unique<Synth>(rate);   // 0.5 MB: never on a thread's stack
  Synth& s = *sp;
  s.instrument = rs.instrument; s.layer = rs.layer; s.useSamples = rs.useSamples; s.bank = rs.bank;
  s.userGain = (float)gain; s.accGain = 0; s.metroGain = 0; s.midiSound = true;
  const int64_t total = (int64_t)((last + tail) * rate) + 1;
  res.seconds = total / rate;

  std::FILE* w = openUtf8(out, "wb");
  if (!w) { res.error = "Cannot write the audio file"; return res; }
  auto u32 = [&](uint32_t v) { std::fwrite(&v, 4, 1, w); };
  auto u16 = [&](uint16_t v) { std::fwrite(&v, 2, 1, w); };
  const uint32_t bytes = (uint32_t)std::min<int64_t>(total * 4, 0xFFFFFFF0LL);
  std::fwrite("RIFF", 1, 4, w); u32(36 + bytes); std::fwrite("WAVEfmt ", 1, 8, w); u32(16); u16(1); u16(2); u32((uint32_t)rate); u32((uint32_t)rate * 4); u16(4); u16(16);
  std::fwrite("data", 1, 4, w); u32(bytes);

  const int B = 256;
  std::vector<float> buf(B * 2);
  std::vector<int16_t> pcm(B * 2);
  size_t k = 0;
  for (int64_t t = 0; t < total; t += B) {
    const int n = (int)std::min<int64_t>(B, total - t);
    // post the events due in this block, each with its exact sample
    while (k < clean.size() && (int64_t)std::llround(clean[k].t * rate) < t + n) {
      const Ev& e = clean[k++];
      Event x{}; x.frame = std::llround(e.t * rate);
      if (e.kind == 3) { x.type = EV_USER_ON; x.midi = (uint8_t)e.midi; x.vel = (uint8_t)e.vel; }
      else if (e.kind == 1) { x.type = EV_USER_OFF; x.midi = (uint8_t)e.midi; }
      else { x.type = EV_PEDAL; x.flag = e.kind == 2 ? 1 : 0; }
      s.post(x);
    }
    s.render(buf.data(), n);
    for (int i = 0; i < n * 2; i++) pcm[i] = (int16_t)std::lround(std::max(-1.f, std::min(1.f, buf[i])) * 32767.f);
    std::fwrite(pcm.data(), 2, (size_t)n * 2, w);
  }
  std::fclose(w);
  res.ok = true;
  return res;
}

}  // namespace nish
