# SkyView - Flight Tracker

Ceiling-projected real-time flight tracker with interactive starfield, HUD, and voice commentary.

## Features
- Real-time flight tracking HUD
- Interactive starfield display
- Voice commentary
- Web-based portal running on `http://localhost:8085`

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher)

### Installation
```bash
npm install
```

### Running the App
Run the quick-start batch file on Windows:
```cmd
run_skyview.bat
```
Or start manually via Node:
```bash
node server.js
```
Then navigate to `http://localhost:8085` in your browser.

### Development Approach
SkyView is a personal project combining aviation interests, systems integration and application development. Document the development tools and AI-assisted workflows used where relevant.

## System Architecture & Data Flow

SkyView combines local ADS-B reception, aircraft message decoding, a Node.js web application and a ceiling-projected visual interface.

### 1. Aircraft Signal Reception
An RTL-SDR receiver and 1090 MHz antenna receive ADS-B transmissions from aircraft within radio reception range.

### 2. ADS-B Message Decoding
The local `dump1090` / `readsb` decoder processes the received aircraft transmissions and makes the resulting aircraft information available to downstream applications.

### 3. Aircraft Data Integration
SkyView uses the local aircraft data source to support its flight-tracking experience.

The precise interface between the decoder and the SkyView application, including the data format and endpoint or file location, should be documented according to the current implementation.

### 4. Web Application
The SkyView Node.js server runs locally and serves the web-based application at `http://localhost:8085`.

### 5. Visualisation and Projection
The browser interface presents the flight-tracking HUD, interactive starfield and voice commentary. The display is configured to work with a physical ceiling projector, creating an immersive overhead flight-tracking experience.

### Data Flow Summary

`RTL-SDR → dump1090 / readsb → Aircraft Data Interface → SkyView Application → Browser → Ceiling Projector`

This diagram represents the logical flow. The exact interfaces and any additional processing stages should be documented after verifying the application code.

### Disclaimer
This is an independent personal project and is not an official aviation tracking or air traffic control system.
