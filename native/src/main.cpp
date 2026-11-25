// nish-audio: the low-latency sound engine of NiSH MarkSteady Piano for Windows.
//
// The desktop app starts this program and talks to it over stdin/stdout, one line per message.
// It plays through an ASIO driver (RtAudio), and reads MIDI keyboards itself (WinMM), so a key press
// goes straight from the MIDI driver to the audio thread: it never waits for the app's window,
// Chromium, or the Windows audio mixer.
//
// Commands (stdin):
//   list                          ASIO drivers, as {"ev":"devices",...}
//   open <id> <rate> <frames>     open a driver; rate 0 = the driver's own, frames 0 = the driver's smallest
//   close                         close the driver
//   panel                         open the driver's own settings window
//   midi on|off                   read MIDI keyboards here (the app must release them first)
//   on <midi> <vel> | off <midi>  a note from the app (computer keyboard, screen)
//   pedal 0|1
//   play <midi> <vel> <delayMs> <durMs>   a play-along note, scheduled ahead
//   click 0|1 <delayMs>           metronome click (1 = accent)
//   cancel                        stop play-along and pending clicks
//   alloff                        release all of your notes
//   inst <name> <layer|none>
//   gain <user> <acc> <metro>     linear gains, already including volume and mute
//   midisound 0|1                 0: keys from the MIDI keyboard make no sound here (piano with own speakers)
//   samples default|<folder>      load a sample bank (default: ..\sounds\upright-kw next to this program)
//   pianosamples 0|1              piano plays the samples (1) or the synth (0, no recorded silence at all)
//   render <id> <file>            play a whole piece offline into a WAV file (for video export); see render.h
//   ping <n>                      replies {"ev":"pong","n":n}
//   quit
// Events (stdout): JSON objects, one per line, e.g. {"ev":"note","midi":60,"vel":90,"down":1,"ago":0.4}
//
// SPDX-License-Identifier: GPL-3.0-or-later
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <mmsystem.h>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <iostream>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include "RtAudio.h"
#include "asio.h"
#include "synth.h"
#include "render.h"

using namespace nish;

static Synth synth(48000);
static std::mutex outLock;
static std::atomic<bool> running{true};
static std::atomic<int> xruns{0};
// commands for the main thread (it owns the ASIO driver and the MIDI handles)
static std::mutex qm;
static std::condition_variable qc;
static std::vector<std::string> cmdq;
static void pushCmd(const std::string& l) { { std::lock_guard<std::mutex> g(qm); cmdq.push_back(l); } qc.notify_one(); }

static std::string esc(const std::string& s) {
  std::string o;
  for (char c : s) {
    if (c == '"' || c == '\\') { o += '\\'; o += c; }
    else if ((unsigned char)c < 0x20) o += ' ';
    else o += c;
  }
  return o;
}
static void emit(const std::string& json) {
  std::lock_guard<std::mutex> g(outLock);
  fputs(json.c_str(), stdout); fputc('\n', stdout); fflush(stdout);
}
static void error(const std::string& where, const std::string& msg) { emit("{\"ev\":\"error\",\"where\":\"" + esc(where) + "\",\"message\":\"" + esc(msg) + "\"}"); }

static double qpcMs() {
  static LARGE_INTEGER f = [] { LARGE_INTEGER x; QueryPerformanceFrequency(&x); return x; }();
  LARGE_INTEGER c; QueryPerformanceCounter(&c);
  return c.QuadPart * 1000.0 / f.QuadPart;
}

// ------------------------------------------------------------------ MIDI input (WinMM)
// The callback runs on a driver thread: it only queues the note for the synth and for the report thread.
struct MidiMsg { uint8_t st, d1, d2; double t; };
static std::mutex midiLock;
static std::condition_variable midiCv;
static std::vector<MidiMsg> midiOut;
static std::vector<HMIDIIN> midiHandles;
static std::vector<std::string> midiNames;
static std::atomic<bool> midiWanted{false};

static void CALLBACK midiProc(HMIDIIN, UINT msg, DWORD_PTR, DWORD_PTR p1, DWORD_PTR) {
  if (msg != MIM_DATA) return;
  const uint8_t st = (uint8_t)(p1 & 0xff), d1 = (uint8_t)((p1 >> 8) & 0x7f), d2 = (uint8_t)((p1 >> 16) & 0x7f);
  const uint8_t kind = st & 0xf0;
  Event e{}; e.frame = 0; bool use = true;
  if (kind == 0x90 && d2 > 0) { e.type = EV_MIDI_ON; e.midi = d1; e.vel = d2; }
  else if (kind == 0x80 || (kind == 0x90 && d2 == 0)) { e.type = EV_MIDI_OFF; e.midi = d1; }
  else if (kind == 0xb0 && d1 == 64) { e.type = EV_MIDI_PEDAL; e.flag = d2 >= 64; }
  else use = false;
  if (!use) return;
  synth.post(e);   // sounds at the start of the next audio buffer
  { std::lock_guard<std::mutex> g(midiLock); midiOut.push_back({kind, d1, d2, qpcMs()}); }
  midiCv.notify_one();
}

static std::vector<std::string> midiDeviceNames() {
  std::vector<std::string> names;
  UINT n = midiInGetNumDevs();
  for (UINT i = 0; i < n; i++) {
    MIDIINCAPSA caps{};
    names.push_back(midiInGetDevCapsA(i, &caps, sizeof caps) == MMSYSERR_NOERROR ? std::string(caps.szPname) : "MIDI input " + std::to_string(i + 1));
  }
  return names;
}
static void midiCloseAll() {
  for (HMIDIIN h : midiHandles) { midiInStop(h); midiInReset(h); midiInClose(h); }
  midiHandles.clear();
}
static void midiOpenAll() {
  midiCloseAll();
  midiNames = midiDeviceNames();
  std::string list = "[";
  for (UINT i = 0; i < midiNames.size(); i++) {
    HMIDIIN h = nullptr;
    MMRESULT r = midiInOpen(&h, i, (DWORD_PTR)midiProc, 0, CALLBACK_FUNCTION);
    bool ok = r == MMSYSERR_NOERROR;
    if (ok) { midiInStart(h); midiHandles.push_back(h); }
    if (i) list += ",";
    list += "{\"name\":\"" + esc(midiNames[i]) + "\",\"ok\":" + (ok ? "true" : "false") + (ok ? "" : (r == MMSYSERR_ALLOCATED ? ",\"why\":\"in use by another program\"" : ",\"why\":\"could not be opened\"")) + "}";
  }
  list += "]";
  emit("{\"ev\":\"midi\",\"devices\":" + list + "}");
}

// Reports keys to the app (for the waterfall, scoring and recording) and watches for keyboards plugged in or out.
static void reportThread() {
  auto lastScan = std::chrono::steady_clock::now();
  while (running) {
    std::vector<MidiMsg> batch;
    {
      std::unique_lock<std::mutex> g(midiLock);
      midiCv.wait_for(g, std::chrono::milliseconds(500), [] { return !midiOut.empty() || !running; });
      batch.swap(midiOut);
    }
    const double now = qpcMs();
    for (auto& m : batch) {
      char buf[160];
      if (m.st == 0xb0) snprintf(buf, sizeof buf, "{\"ev\":\"pedal\",\"down\":%d,\"ago\":%.2f}", m.d2 >= 64, now - m.t);
      else snprintf(buf, sizeof buf, "{\"ev\":\"note\",\"midi\":%d,\"vel\":%d,\"down\":%d,\"ago\":%.2f}", m.d1, m.d2, (m.st == 0x90 && m.d2 > 0) ? 1 : 0, now - m.t);
      emit(buf);
    }
    if (std::chrono::steady_clock::now() - lastScan > std::chrono::milliseconds(1500)) {
      lastScan = std::chrono::steady_clock::now();
      if (midiWanted) pushCmd("midiscan");   // the main thread rescans: WinMM calls stay on one thread
      static int lastX = 0; int x = xruns.load();
      if (x != lastX) { lastX = x; emit("{\"ev\":\"xrun\",\"count\":" + std::to_string(x) + "}"); }
    }
  }
}

// ------------------------------------------------------------------ ASIO output (RtAudio)
static RtAudio* rt = nullptr;
static unsigned openFrames = 0, openRate = 0;

static int audioCallback(void* out, void*, unsigned int n, double, RtAudioStreamStatus status, void*) {
  if (status & RTAUDIO_OUTPUT_UNDERFLOW) xruns++;
  synth.render((float*)out, (int)n);
  return 0;
}
static void rtError(RtAudioErrorType, const std::string& msg) { error("asio", msg); }

static RtAudio& audio() {
  if (!rt) rt = new RtAudio(RtAudio::WINDOWS_ASIO, &rtError);
  return *rt;
}

static void listDevices() {
  std::ostringstream o;
  o << "{\"ev\":\"devices\",\"api\":\"asio\",\"devices\":[";
  bool first = true;
  if (audio().isStreamOpen()) {
    // ASIO allows one driver at a time: report the open one without probing the others
    o << "]" << ",\"busy\":true}";
    emit(o.str());
    return;
  }
  for (unsigned id : audio().getDeviceIds()) {
    RtAudio::DeviceInfo d = audio().getDeviceInfo(id);
    if (d.outputChannels < 2) continue;
    if (!first) o << ",";
    first = false;
    o << "{\"id\":" << id << ",\"name\":\"" << esc(d.name) << "\",\"outputs\":" << d.outputChannels << ",\"rate\":" << d.preferredSampleRate << ",\"rates\":[";
    for (size_t i = 0; i < d.sampleRates.size(); i++) o << (i ? "," : "") << d.sampleRates[i];
    o << "]}";
  }
  o << "]}";
  emit(o.str());
}

static void closeStream() {
  if (rt && rt->isStreamOpen()) {
    if (rt->isStreamRunning()) rt->stopStream();
    rt->closeStream();
  }
  openFrames = openRate = 0;
  xruns = 0;
}

static void openStream(unsigned id, unsigned rate, unsigned frames) {
  closeStream();
  RtAudio& a = audio();
  RtAudio::DeviceInfo d = a.getDeviceInfo(id);
  if (d.outputChannels < 2) { error("open", "This ASIO driver has no stereo output."); return; }
  if (!rate) rate = d.preferredSampleRate ? d.preferredSampleRate : 48000;
  RtAudio::StreamParameters p; p.deviceId = id; p.nChannels = 2; p.firstChannel = 0;
  RtAudio::StreamOptions opt;
  opt.flags = RTAUDIO_SCHEDULE_REALTIME | (frames == 0 ? RTAUDIO_MINIMIZE_LATENCY : 0);
  opt.streamName = "NiSH MarkSteady Piano";
  unsigned bf = frames ? frames : 32;
  synth.setRate(rate);
  if (a.openStream(&p, nullptr, RTAUDIO_FLOAT32, rate, &bf, &audioCallback, nullptr, &opt) != RTAUDIO_NO_ERROR) {
    error("open", a.getErrorText());
    return;
  }
  if (a.startStream() != RTAUDIO_NO_ERROR) { error("start", a.getErrorText()); a.closeStream(); return; }
  openFrames = bf; openRate = a.getStreamSampleRate();
  if (openRate && openRate != rate) synth.setRate(openRate);
  // getStreamLatency: the driver's own output latency in frames (ASIOGetLatencies), which includes its buffer
  long lat = a.getStreamLatency();
  const double sr = openRate ? openRate : rate;
  char buf[320];
  snprintf(buf, sizeof buf, "{\"ev\":\"opened\",\"id\":%u,\"name\":\"%s\",\"rate\":%u,\"frames\":%u,\"bufferMs\":%.2f,\"outputMs\":%.2f}",
           id, esc(d.name).c_str(), (unsigned)sr, bf, bf * 1000.0 / sr, (lat > 0 ? lat : bf) * 1000.0 / sr);
  emit(buf);
}

// ------------------------------------------------------------------ sample bank
static std::string exeDir() {
  wchar_t w[MAX_PATH * 2] = {0};
  DWORD n = GetModuleFileNameW(nullptr, w, MAX_PATH * 2);
  std::wstring p(w, n);
  size_t cut = p.find_last_of(L"\\/");
  if (cut != std::wstring::npos) p.resize(cut);
  int len = WideCharToMultiByte(CP_UTF8, 0, p.c_str(), -1, nullptr, 0, nullptr, nullptr);
  std::string u(len > 0 ? len - 1 : 0, '\0');
  if (len > 0) WideCharToMultiByte(CP_UTF8, 0, p.c_str(), -1, &u[0], len, nullptr, nullptr);
  return u;
}
static void loadSamples(std::string dir) {
  if (dir.empty() || dir == "default") dir = exeDir() + "\\..\\sounds\\upright-kw";
  const double t0 = qpcMs();
  std::string err;
  Bank* b = loadBank(dir, err);
  if (!b) { emit("{\"ev\":\"samples\",\"ok\":false,\"message\":\"" + esc(err) + "\"}"); return; }
  // the old bank (if any) is kept alive: a voice may still be reading it
  synth.bank.store(b, std::memory_order_release);
  char buf[400];
  snprintf(buf, sizeof buf, "{\"ev\":\"samples\",\"ok\":true,\"name\":\"%s\",\"samples\":%zu,\"regions\":%zu,\"mb\":%.1f,\"ms\":%.0f}",
           esc(b->name).c_str(), b->samples.size(), b->regions.size(), b->mb(), qpcMs() - t0);
  emit(buf);
}

// ------------------------------------------------------------------ commands
static void command(const std::string& line) {
  std::istringstream in(line);
  std::string c; in >> c;
  if (c.empty()) return;
  if (c == "on" || c == "off") {
    int m = 0, v = 90; in >> m; if (c == "on") in >> v;
    if (m < 0 || m > 127) return;
    Event e{}; e.type = c == "on" ? EV_USER_ON : EV_USER_OFF; e.midi = (uint8_t)m; e.vel = (uint8_t)std::max(1, std::min(127, v));
    synth.post(e);
  } else if (c == "pedal") {
    int d = 0; in >> d; Event e{}; e.type = EV_PEDAL; e.flag = d ? 1 : 0; synth.post(e);
  } else if (c == "play") {
    int m = 0, v = 80; double delay = 0, dur = 0; in >> m >> v >> delay >> dur;
    if (m < 0 || m > 127) return;
    Event e{}; e.type = EV_PLAY; e.midi = (uint8_t)m; e.vel = (uint8_t)std::max(1, std::min(127, v));
    e.frame = synth.now() + synth.msToFrames(std::max(0.0, delay)); e.dur = synth.msToFrames(dur);
    synth.post(e);
  } else if (c == "click") {
    int acc = 0; double delay = 0; in >> acc >> delay;
    Event e{}; e.type = EV_CLICK; e.vel = acc ? 1 : 0; e.frame = synth.now() + synth.msToFrames(std::max(0.0, delay));
    synth.post(e);
  } else if (c == "cancel") {
    Event e{}; e.type = EV_CANCEL_ACC; synth.post(e);
  } else if (c == "alloff") {
    Event e{}; e.type = EV_ALL_OFF; synth.post(e);
  } else if (c == "inst") {
    std::string a, b; in >> a >> b;
    int i = instFromName(a.c_str()); if (i != NONE) synth.instrument = i;
    synth.layer = b.empty() ? NONE : instFromName(b.c_str());
  } else if (c == "gain") {
    float u = 0, a = 0, m = 0; in >> u >> a >> m;
    synth.userGain = u; synth.accGain = a; synth.metroGain = m;
  } else if (c == "midisound") {
    int on = 1; in >> on; synth.midiSound = on != 0;
  } else if (c == "list") {
    listDevices();
  } else if (c == "open") {
    unsigned id = 0, rate = 0, frames = 0; in >> id >> rate >> frames;
    openStream(id, rate, frames);
  } else if (c == "close") {
    closeStream(); emit("{\"ev\":\"closed\"}");
  } else if (c == "panel") {
    if (rt && rt->isStreamOpen()) ASIOControlPanel(); else error("panel", "Open a driver first.");
  } else if (c == "midi") {
    std::string s; in >> s;
    if (s == "on") { midiWanted = true; midiOpenAll(); }
    else { midiWanted = false; midiCloseAll(); emit("{\"ev\":\"midi\",\"devices\":[]}"); }
  } else if (c == "midiscan") {
    if (midiWanted && midiDeviceNames() != midiNames) { Event e{}; e.type = EV_ALL_OFF; synth.post(e); midiOpenAll(); }
  } else if (c == "samples") {
    std::string rest; std::getline(in, rest);
    size_t a = rest.find_first_not_of(' '); rest = a == std::string::npos ? "" : rest.substr(a);
    loadSamples(rest);
  } else if (c == "render") {
    std::string id, rest; in >> id; std::getline(in, rest);
    size_t a = rest.find_first_not_of(' '); rest = a == std::string::npos ? "" : rest.substr(a);
    // on its own thread: live keys and commands carry on while the piece renders
    RenderSettings rs{ synth.instrument.load(), synth.layer.load(), synth.useSamples.load(), synth.bank.load() };
    std::thread([id, rest, rs] {
      const double t0 = qpcMs();
      RenderResult r = renderFile(rest, rs);
      char buf[300];
      if (r.ok) snprintf(buf, sizeof buf, "{\"ev\":\"rendered\",\"id\":\"%s\",\"ok\":true,\"seconds\":%.2f,\"notes\":%d,\"ms\":%.0f}", esc(id).c_str(), r.seconds, r.notes, qpcMs() - t0);
      else snprintf(buf, sizeof buf, "{\"ev\":\"rendered\",\"id\":\"%s\",\"ok\":false,\"message\":\"%s\"}", esc(id).c_str(), esc(r.error).c_str());
      emit(buf);
    }).detach();
  } else if (c == "pianosamples") {
    int on = 1; in >> on; synth.useSamples = on != 0;
  } else if (c == "ping") {
    std::string n; in >> n; emit("{\"ev\":\"pong\",\"n\":\"" + esc(n) + "\"}");
  } else if (c == "quit") {
    running = false;
  }
}

int main() {
  // the process and the command thread get a higher priority, so a busy app window cannot delay a key
  SetPriorityClass(GetCurrentProcess(), HIGH_PRIORITY_CLASS);
  timeBeginPeriod(1);
  setvbuf(stdout, nullptr, _IOFBF, 1 << 16);
  emit("{\"ev\":\"ready\",\"version\":1}");
  std::thread reporter(reportThread);
  pushCmd("samples default");   // load the piano into memory before the first key, off the audio thread
  // stdin lines go to the command queue; WinMM and ASIO calls all happen on this main thread
  std::thread reader([&] {
    std::string line;
    while (std::getline(std::cin, line)) {
      if (!line.empty() && line.back() == '\r') line.pop_back();
      // notes skip the queue: post them straight to the synth from this thread
      if (line.rfind("on ", 0) == 0 || line.rfind("off ", 0) == 0 || line.rfind("pedal ", 0) == 0 || line.rfind("play ", 0) == 0 || line.rfind("click ", 0) == 0) { command(line); continue; }
      pushCmd(line);
    }
    pushCmd("quit");   // the app closed our stdin: it has gone
  });
  while (running) {
    std::vector<std::string> batch;
    {
      std::unique_lock<std::mutex> g(qm);
      qc.wait_for(g, std::chrono::milliseconds(250), [] { return !cmdq.empty(); });
      batch.swap(cmdq);
    }
    for (auto& l : batch) { command(l); if (!running) break; }
  }
  midiWanted = false;
  midiCloseAll();
  closeStream();
  delete rt; rt = nullptr;
  running = false;
  midiCv.notify_all();
  reporter.join();
  reader.detach();
  timeEndPeriod(1);
  return 0;
}
