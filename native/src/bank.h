// NiSH MarkSteady Piano: a packed sample bank for the native engine.
// tools/build_piano.py turns an SFZ instrument into two files:
//   index.txt  - one line per sample ("s ...") and per key/velocity region ("r ...")
//   piano.pcm  - every sample as 16-bit PCM, start silence already trimmed
// The whole bank is loaded into memory before it is used: playing a note never touches the disk.
//
// index.txt lines:
//   nishbank 1 <name...>
//   s <id> <offset> <frames> <channels> <rate> <loopStart> <loopEnd>      offset in int16 values; loop -1 = none
//   r <sample> <lokey> <hikey> <key> <lovel> <hivel> <release 0|1> <tuneCents> <gainDb> <veltrack%> <releaseSec> <rtDecayDb>
//
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif

namespace nish {

struct BankSample { int64_t offset = 0, frames = 0, loopStart = -1, loopEnd = -1; int channels = 1; double rate = 48000; };
struct BankRegion {
  int sample = 0; int lokey = 0, hikey = 127, key = 60, lovel = 1, hivel = 127; bool release = false;
  float tune = 0, gainDb = 0, veltrack = 100, releaseSec = 0.3f, rtDecay = 0;
};
struct Bank {
  std::string name;
  std::vector<int16_t> pcm;
  std::vector<BankSample> samples;
  std::vector<BankRegion> regions;
  double mb() const { return pcm.size() * 2.0 / (1024.0 * 1024.0); }
  /** The region that plays this key at this velocity (attack or release), or nullptr. */
  const BankRegion* find(int key, int vel, bool release) const {
    for (const auto& r : regions)
      if (r.release == release && key >= r.lokey && key <= r.hikey && vel >= r.lovel && vel <= r.hivel) return &r;
    // velocity outside every layer: take the nearest layer for this key
    const BankRegion* best = nullptr; int bestD = 1 << 30;
    for (const auto& r : regions) {
      if (r.release != release || key < r.lokey || key > r.hikey) continue;
      int d = vel < r.lovel ? r.lovel - vel : vel - r.hivel;
      if (d < bestD) { bestD = d; best = &r; }
    }
    return best;
  }
};

/** fopen for a UTF-8 path (Windows needs the wide form for names such as "Åsa"). */
inline std::FILE* openUtf8(const std::string& path, const char* mode) {
#ifdef _WIN32
  auto widen = [](const std::string& s) {
    int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0);
    std::wstring w(n > 0 ? n - 1 : 0, L'\0');
    if (n > 0) MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, &w[0], n);
    return w;
  };
  return _wfopen(widen(path).c_str(), widen(mode).c_str());
#else
  return std::fopen(path.c_str(), mode);
#endif
}

/** Load a bank folder. Returns nullptr and sets err on failure. */
inline Bank* loadBank(const std::string& dir, std::string& err) {
  const std::string sep = (!dir.empty() && (dir.back() == '/' || dir.back() == '\\')) ? "" : "/";
  std::FILE* f = openUtf8(dir + sep + "index.txt", "rb");
  if (!f) { err = "No sample bank in " + dir; return nullptr; }
  Bank* b = new Bank();
  char line[1024];
  bool header = false;
  while (std::fgets(line, sizeof line, f)) {
    if (std::strncmp(line, "nishbank ", 9) == 0) {
      int ver = 0; char name[512] = {0};
      if (std::sscanf(line + 9, "%d %511[^\r\n]", &ver, name) >= 1 && ver == 1) { header = true; b->name = name; }
    } else if (line[0] == 's' && line[1] == ' ') {
      BankSample s; int id = 0; long long off = 0, fr = 0, ls = -1, le = -1;
      if (std::sscanf(line + 2, "%d %lld %lld %d %lf %lld %lld", &id, &off, &fr, &s.channels, &s.rate, &ls, &le) == 7) {
        s.offset = off; s.frames = fr; s.loopStart = ls; s.loopEnd = le;
        if ((int)b->samples.size() != id) { err = "Sample list out of order"; break; }
        b->samples.push_back(s);
      }
    } else if (line[0] == 'r' && line[1] == ' ') {
      BankRegion r; int rel = 0;
      if (std::sscanf(line + 2, "%d %d %d %d %d %d %d %f %f %f %f %f", &r.sample, &r.lokey, &r.hikey, &r.key, &r.lovel, &r.hivel, &rel, &r.tune, &r.gainDb, &r.veltrack, &r.releaseSec, &r.rtDecay) == 12) {
        r.release = rel != 0;
        b->regions.push_back(r);
      }
    }
  }
  std::fclose(f);
  if (err.empty() && !header) err = "Not a NiSH sample bank (index.txt has no header)";
  if (err.empty() && (b->samples.empty() || b->regions.empty())) err = "The sample bank is empty";
  if (!err.empty()) { delete b; return nullptr; }

  int64_t total = 0;
  for (auto& s : b->samples) total = std::max<int64_t>(total, s.offset + s.frames * s.channels);
  std::FILE* p = openUtf8(dir + sep + "piano.pcm", "rb");
  if (!p) { err = "piano.pcm is missing"; delete b; return nullptr; }
  b->pcm.resize((size_t)total);
  size_t got = std::fread(b->pcm.data(), 2, (size_t)total, p);
  std::fclose(p);
  if (got != (size_t)total) { err = "piano.pcm is shorter than its index"; delete b; return nullptr; }
  for (auto& r : b->regions)
    if (r.sample < 0 || r.sample >= (int)b->samples.size()) { err = "A region points at a missing sample"; delete b; return nullptr; }
  return b;
}

}  // namespace nish
