# NiSH MarkSteady Piano native audio engine (Windows, ASIO).
# Build:  cmake -S native -B build -DRTAUDIO_DIR=<path to an RtAudio 6 checkout> && cmake --build build --config Release
# The synth test also builds on Linux/macOS:  cmake -S native -B build-test -DNISH_TEST_ONLY=ON
cmake_minimum_required(VERSION 3.16)
cmake_policy(SET CMP0091 NEW)
project(nish_audio CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
option(NISH_TEST_ONLY "Only build the offline synth test" OFF)

add_executable(nish-synth-test test/synth_test.cpp)
if(NISH_TEST_ONLY)
  return()
endif()

if(NOT WIN32)
  message(FATAL_ERROR "nish-audio is a Windows program (ASIO). Use -DNISH_TEST_ONLY=ON elsewhere.")
endif()
if(NOT RTAUDIO_DIR OR NOT EXISTS "${RTAUDIO_DIR}/RtAudio.cpp")
  message(FATAL_ERROR "Set RTAUDIO_DIR to an RtAudio 6 checkout (it carries the ASIO host files under include/).")
endif()

# no Visual C++ runtime to install: link it in
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

file(GLOB ASIO_SOURCES "${RTAUDIO_DIR}/include/*.cpp")
add_executable(nish-audio src/main.cpp "${RTAUDIO_DIR}/RtAudio.cpp" ${ASIO_SOURCES})
target_include_directories(nish-audio PRIVATE src "${RTAUDIO_DIR}" "${RTAUDIO_DIR}/include")
target_compile_definitions(nish-audio PRIVATE __WINDOWS_ASIO__ _CRT_SECURE_NO_WARNINGS NOMINMAX)
target_link_libraries(nish-audio PRIVATE ole32 winmm user32 advapi32 uuid)
if(MSVC)
  target_compile_options(nish-audio PRIVATE /O2 /fp:fast /W3 /EHsc)
endif()
