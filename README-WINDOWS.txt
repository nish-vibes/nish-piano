NiSH MarkSteady Piano for Windows
=============================

Two ways to run it, neither needs administrator rights:

1. NiSH-MarkSteady-Piano-2.0.0-x64.exe (installer)
   Installs for your user only and adds Start menu and desktop shortcuts.

2. NiSH-MarkSteady-Piano-2.0.0-portable.exe
   Runs without installing. Keep it in any folder, for example on a USB stick.

Windows may show "Windows protected your PC" because the app is not code-signed yet.
Click "More info", then "Run anyway".

Reading scanned sheet music
---------------------------
Drop a PDF, PNG or JPG of a printed score onto the window. The app checks the page,
enlarges small print, and reads it with the built-in Audiveris reader. You then check
the result against the original, bar by bar, before you practise.

For the best result:
- Scan at 300 dpi in greyscale (not "photo" or "draft" quality).
- Lay the page flat and straight; avoid shadows and curved pages.
- One page per image is fine; a multi-page PDF is read as one piece.
- Phone photos work best taken straight above the page in daylight.

The shortest delay between key and sound (ASIO)
-----------------------------------------------
Open Sound and devices (the Sound button), then turn on "ASIO engine".
The app then plays through an ASIO driver and reads your MIDI keyboard itself, so a key
sounds within one audio buffer. The menu shows the delay it measured.

- With an audio interface: install its own ASIO driver (Focusrite, Steinberg, RME, Behringer...).
- With built-in sound: install a general ASIO driver such as ASIO4ALL or FlexASIO, then
  choose "Find drivers".
- Buffer: start with "Smallest the driver allows". If you hear clicks, choose a larger one.
- "Driver settings" opens the driver's own window (buffer size, output channels).
- Bluetooth headphones and speakers always add a long delay; use wired ones.
- While ASIO is on, other programs may not be able to use the same audio device.
- If your keyboard is "in use by another program", close that program, or press
  "Restart the app".

Piano sound: "Upright (sampled)" plays Upright Piano KW, a real Kawai upright (FreePats,
public domain), held in memory with the silence before each note trimmed away. "Synth" is
the built-in synthesized piano, which has no recorded sound at all. The sampled piano plays
in the ASIO engine; the standard engine uses the synth.

"Disable Windows audio effects" turns off Windows sound enhancements for every output
(Windows asks for permission). They add delay to the standard engine; ASIO skips them.
"Turn Windows audio effects back on" restores each output exactly as it was.

Your songs are saved on this computer only.
