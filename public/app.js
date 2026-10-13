// SkyView Tactical Flight Radar - Core Controller

(function () {
  // Global Application State
  const state = {
    // Connection Settings
    mode: 'simulated', // 'simulated' | 'live'
    dump1090Url: 'http://localhost:8080',
    receiverLat: -33.8688, // Sydney Default
    receiverLon: 151.2093,
    receiverAutoDetected: false,
    
    // Voice Commentary Settings
    voiceStyle: 'tactical', // 'tactical' | 'cozy' | 'disabled'
    voiceInterval: 30, // seconds
    voiceVolume: 0.8,
    selectedVoiceName: 'default',
    
    // Optics & Display Settings
    projectionRotation: 0,
    mirrorH: false,
    mirrorV: false,
    starCount: 1500,
    starSpeed: 15,
    radarRangeFilter: 100, // NM
    trailLength: 30,
    muted: false,
    
    // Telemetry State
    aircraft: {}, // Map of hex -> aircraft data
    selectedFlightHex: null,
    radarSweepAngle: 0,
    isOnline: false,
    
    // Timing and Intervals
    fetchTimer: null,
    voiceTimer: null,
    lastVoiceTime: 0
  };

  // Synthesized Web Audio API Sound Engine (No files required!)
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  
  function playSound(type) {
    if (state.muted) return;
    
    try {
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }
      
      const now = audioContext.currentTime;
      
      if (type === 'sonar') {
        // High frequency sonar ping with exponential decay
        const osc = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        osc.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(150, now + 1.2);
        
        gainNode.gain.setValueAtTime(0.08 * state.voiceVolume, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
        
        osc.start(now);
        osc.stop(now + 1.5);
      } else if (type === 'lock') {
        // Rapid double beep indicating target lock-on
        for (let i = 0; i < 2; i++) {
          const osc = audioContext.createOscillator();
          const gainNode = audioContext.createGain();
          
          osc.connect(gainNode);
          gainNode.connect(audioContext.destination);
          
          osc.type = 'square';
          osc.frequency.setValueAtTime(1000, now + i * 0.15);
          
          gainNode.gain.setValueAtTime(0.05 * state.voiceVolume, now + i * 0.15);
          gainNode.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.1);
          
          osc.start(now + i * 0.15);
          osc.stop(now + i * 0.15 + 0.12);
        }
      } else if (type === 'sweep') {
        // Soft click/tick sound for sweep line passing
        const osc = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        osc.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(50, now);
        
        gainNode.gain.setValueAtTime(0.03 * state.voiceVolume, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        
        osc.start(now);
        osc.stop(now + 0.06);
      }
    } catch (e) {
      console.warn("Audio failed to play:", e);
    }
  }

  // Pre-compiled Aircraft database (focused on Military & Common Commercial)
  const AIRCRAFT_MODELS = {
    // Fighter Jets & Military Bombers (tactical highlights)
    'F16': { desc: 'General Dynamics F-16 Fighting Falcon', military: true },
    'F15': { desc: 'McDonnell Douglas F-15 Eagle', military: true },
    'F18': { desc: 'McDonnell Douglas F/A-18 Hornet', military: true },
    'F22': { desc: 'Lockheed Martin F-22 Raptor', military: true },
    'F35': { desc: 'Lockheed Martin F-35 Lightning II', military: true },
    'A10': { desc: 'Fairchild Republic A-10 Thunderbolt II', military: true },
    'B1': { desc: 'Rockwell B-1 Lancer', military: true },
    'B2': { desc: 'Northrop Grumman B-2 Spirit', military: true },
    'B52': { desc: 'Boeing B-52 Stratofortress', military: true },
    'C17': { desc: 'Boeing C-17 Globemaster III', military: true },
    'C130': { desc: 'Lockheed C-130 Hercules', military: true },
    'KC10': { desc: 'McDonnell Douglas KC-10 Extender', military: true },
    'KC35': { desc: 'Boeing KC-135 Stratotanker', military: true },
    'E3TF': { desc: 'Boeing E-3 Sentry (AWACS)', military: true },
    'P8': { desc: 'Boeing P-8 Poseidon', military: true },
    'T45': { desc: 'McDonnell Douglas T-45 Goshawk', military: true },
    'T38': { desc: 'Northrop T-38 Talon', military: true },
    'TYF': { desc: 'Eurofighter Typhoon', military: true },
    'RFL': { desc: 'Dassault Rafale', military: true },
    'SU27': { desc: 'Sukhoi Su-27 Flanker', military: true },
    'SU30': { desc: 'Sukhoi Su-30 Flanker-C', military: true },
    'SU35': { desc: 'Sukhoi Su-35 Flanker-E', military: true },
    'SU57': { desc: 'Sukhoi Su-57 Felon', military: true },
    'MIG29': { desc: 'Mikoyan MiG-29 Fulcrum', military: true },
    'MIG31': { desc: 'Mikoyan MiG-31 Foxhound', military: true },
    
    // Commercial Airliners & Shortened ICAO Model Codes
    'A19N': { desc: 'Airbus A319neo', military: false },
    'A20N': { desc: 'Airbus A320neo', military: false },
    'A21N': { desc: 'Airbus A321neo', military: false },
    'A318': { desc: 'Airbus A318', military: false },
    'A319': { desc: 'Airbus A319', military: false },
    'A320': { desc: 'Airbus A320', military: false },
    'A321': { desc: 'Airbus A321', military: false },
    'BCS1': { desc: 'Airbus A220-100', military: false },
    'BCS3': { desc: 'Airbus A220-300', military: false },
    'A332': { desc: 'Airbus A330-200', military: false },
    'A333': { desc: 'Airbus A330-300', military: false },
    'A338': { desc: 'Airbus A330-800neo', military: false },
    'A339': { desc: 'Airbus A330-900neo', military: false },
    'A343': { desc: 'Airbus A340-300', military: false },
    'A346': { desc: 'Airbus A340-600', military: false },
    'A359': { desc: 'Airbus A350-900', military: false },
    'A35K': { desc: 'Airbus A350-1000', military: false },
    'A388': { desc: 'Airbus A380-800', military: false },
    'B737': { desc: 'Boeing 737-700', military: false },
    'B738': { desc: 'Boeing 737-800', military: false },
    'B739': { desc: 'Boeing 737-900', military: false },
    'B37M': { desc: 'Boeing 737 MAX 7', military: false },
    'B38M': { desc: 'Boeing 737 MAX 8', military: false },
    'B39M': { desc: 'Boeing 737 MAX 9', military: false },
    'B3XM': { desc: 'Boeing 737 MAX 10', military: false },
    'B744': { desc: 'Boeing 747-400', military: false },
    'B748': { desc: 'Boeing 747-8i', military: false },
    'B752': { desc: 'Boeing 757-200', military: false },
    'B753': { desc: 'Boeing 757-300', military: false },
    'B763': { desc: 'Boeing 767-300', military: false },
    'B772': { desc: 'Boeing 777-200', military: false },
    'B77L': { desc: 'Boeing 777-200LR', military: false },
    'B77W': { desc: 'Boeing 777-300ER', military: false },
    'B788': { desc: 'Boeing 787-8 Dreamliner', military: false },
    'B789': { desc: 'Boeing 787-9 Dreamliner', military: false },
    'B78X': { desc: 'Boeing 787-10 Dreamliner', military: false },
    'E170': { desc: 'Embraer E170', military: false },
    'E175': { desc: 'Embraer E175', military: false },
    'E190': { desc: 'Embraer E190', military: false },
    'E195': { desc: 'Embraer E195', military: false },
    'E290': { desc: 'Embraer E190-E2', military: false },
    'E295': { desc: 'Embraer E195-E2', military: false },
    'CRJ2': { desc: 'Bombardier CRJ-200', military: false },
    'CRJ7': { desc: 'Bombardier CRJ-700', military: false },
    'CRJ9': { desc: 'Bombardier CRJ-900', military: false },
    'DH8D': { desc: 'De Havilland Dash 8 Q400', military: false },
    'AT72': { desc: 'ATR 72-600', military: false },
    'AT76': { desc: 'ATR 72-600', military: false },
    'ATR72': { desc: 'ATR 72', military: false },
    'C172': { desc: 'Cessna 172 Skyhawk', military: false }
  };

  // Common military callsign patterns
  const MILITARY_CALLSIGNS = [
    'RCH', 'CNV', 'SHND', 'RRR', 'ASY', 'HAWK', 'LION', 'RAIDER', 'BOGEY', 
    'VADER', 'STRIKE', 'REAPER', 'DRAG', 'VIPER', 'RHINO', 'JAGUAR', 'TALON',
    'FIGHTER', 'RAPTOR', 'HORNET', 'PHANTOM', 'WARTHOG', 'SENTRY', 'AWACS',
    'NAVY', 'ARMY', 'PATROL', 'TACTICAL', 'GUARD', 'ANAF', 'EXEC', 'COBRA'
  ];

  // Helper: Decode Airline from flight number prefix
  function parseAirline(flight, model) {
    if (!flight) return { name: 'Private/Unknown', callsign: '', country: '', logo: '' };
    const cleanFlight = flight.trim().toUpperCase();
    const icao = cleanFlight.substring(0, 3);
    
    // Explicit QantasLink regional prefix check
    if (['QLK', 'SSQ', 'EAQ', 'NJE'].includes(icao)) {
      return { name: 'QantasLink', callsign: 'QANTASLINK', country: 'Australia' };
    }
    
    // Differentiate Qantas Mainline vs QantasLink based on flight number or regional aircraft model
    if (icao === 'QFA') {
      const match = cleanFlight.match(/^QFA(\d+)/);
      const num = match ? parseInt(match[1]) : 0;
      const cleanModel = model ? model.trim().toUpperCase() : '';
      const isRegionalModel = ['DH8D', 'DH8C', 'DH8A', 'DHC8', 'E190', 'BCS3', 'BCS1', 'B712', 'F100', 'F70', 'SF34', 'AT72', 'AT76'].includes(cleanModel);
      
      if (num >= 1200 || isRegionalModel) {
        return { name: 'QantasLink', callsign: 'QANTASLINK', country: 'Australia' };
      }
      return { name: 'Qantas Airways', callsign: 'QANTAS', country: 'Australia' };
    }
    
    if (window.AIRLINES && window.AIRLINES[icao]) {
      return window.AIRLINES[icao];
    }
    
    // Check IATA (first 2 letters) as fallback
    const iata = cleanFlight.substring(0, 2);
    if (window.AIRLINES) {
      const match = Object.values(window.AIRLINES).find(a => a.iata === iata);
      if (match) return match;
    }
    
    return { name: 'Unregistered Carrier', callsign: icao, country: '' };
  }

  // Helper: Resolve Shortened ICAO Aircraft Model Code
  function resolveAircraftModelCode(t, category, speed, alt, isTactical) {
    if (t && t !== 'UNKN' && t !== 'N/A' && t.trim() !== '') {
      return t.trim().toUpperCase();
    }
    const aClass = getAircraftClass(t, isTactical, category, speed, alt);
    switch (aClass) {
      case 'large_airliner': return 'A359';
      case 'turboprop': return 'DH8D';
      case 'light': return 'C172';
      case 'fighter': return 'F18';
      case 'military_heavy': return 'C17';
      default: return 'B738';
    }
  }

  // Helper: Decode Aircraft Model Description using Shortened ICAO Code
  function parseModel(t, plane) {
    let cleanType = (t && t !== 'UNKN' && t !== 'N/A') ? t.trim().toUpperCase() : null;
    if (!cleanType && plane) {
      cleanType = resolveAircraftModelCode(plane.t, plane.category, plane.gs, plane.alt_baro, plane.isTactical);
    }
    if (!cleanType) cleanType = 'B738';

    if (AIRCRAFT_MODELS[cleanType]) {
      const info = AIRCRAFT_MODELS[cleanType];
      return { code: cleanType, desc: `${cleanType} · ${info.desc}`, military: info.military };
    }
    return { code: cleanType, desc: `${cleanType} · Airliner`, military: false };
  }

  // Helper: Check if a flight is tactical/military
  function isTacticalFlight(flight, icaoType, category) {
    if (!flight) return false;
    const cleanFlight = flight.trim().toUpperCase();
    
    // 1. Check callsign prefixes
    const callsignPrefix3 = cleanFlight.substring(0, 3);
    const callsignPrefix4 = cleanFlight.substring(0, 4);
    const callsignPrefix5 = cleanFlight.substring(0, 5);
    
    if (MILITARY_CALLSIGNS.includes(callsignPrefix3) || 
        MILITARY_CALLSIGNS.includes(callsignPrefix4) ||
        MILITARY_CALLSIGNS.includes(callsignPrefix5)) {
      return true;
    }
    
    // 2. Check ICAO aircraft type mapping
    if (icaoType && AIRCRAFT_MODELS[icaoType.trim().toUpperCase()]?.military) {
      return true;
    }

    // 3. Category flag check (dump1090 categorization)
    // Categories A6, B6, C6 represent military/high performance aircraft
    if (category && (category === 'A6' || category === 'B6' || category === 'C6')) {
      return true;
    }
    
    return false;
  }

  // Airline color coding map — signature brand colours tuned for ceiling projection
  const AIRLINE_COLORS = {
    // ── Domestic Carriers ──────────────────────────────────────────────────
    'QFA': { main: '#FF4D4D', glow: 'rgba(255, 77,  77,  0.65)' },  // Qantas Airways (Mainline) — Bright Coral Red
    'QLK': { main: '#D81B60', glow: 'rgba(216, 27,  96,  0.65)' },  // QantasLink      — Deep Crimson Rose
    'SSQ': { main: '#D81B60', glow: 'rgba(216, 27,  96,  0.65)' },  // Sunstate QantasLink — Deep Crimson Rose
    'EAQ': { main: '#D81B60', glow: 'rgba(216, 27,  96,  0.65)' },  // Eastern QantasLink  — Deep Crimson Rose
    'NJE': { main: '#D81B60', glow: 'rgba(216, 27,  96,  0.65)' },  // National Jet QantasLink — Deep Crimson Rose
    'JST': { main: '#FF9F43', glow: 'rgba(255, 159, 67,  0.65)' },  // Jetstar         — Vibrant Orange
    'VOZ': { main: '#FF66B2', glow: 'rgba(255, 102, 178, 0.65)' },  // Virgin Australia — Light Magenta
    'RXA': { main: '#33C1FF', glow: 'rgba(51,  193, 255, 0.65)' },  // Rex Airlines    — Bright Sky Blue
    'FPE': { main: '#FFD23F', glow: 'rgba(255, 210, 63,  0.65)' },  // FlyPelican      — Sunburst Yellow
    'LKA': { main: '#26E6B4', glow: 'rgba(38,  230, 180, 0.65)' },  // Link Airways    — Mint Teal

    // ── International Carriers ─────────────────────────────────────────────
    'ANZ': { main: '#E0E0E0', glow: 'rgba(224, 224, 224, 0.55)' },  // Air New Zealand — Pale Silver-Grey
    'SIA': { main: '#FFE399', glow: 'rgba(255, 227, 153, 0.65)' },  // Singapore Airlines — Champagne Gold
    'CPA': { main: '#4DFFD2', glow: 'rgba(77,  255, 210, 0.65)' },  // Cathay Pacific  — Light Jade Green
    'UAE': { main: '#FFF2CC', glow: 'rgba(255, 242, 204, 0.60)' },  // Emirates        — Cream Gold
    'UAL': { main: '#00D2FF', glow: 'rgba(0,   210, 255, 0.65)' },  // United Airlines — Electric Cyan
    'DAL': { main: '#80E5FF', glow: 'rgba(128, 229, 255, 0.60)' },  // Delta Air Lines — Soft Sky Blue
    'ACA': { main: '#A6F0FF', glow: 'rgba(166, 240, 255, 0.60)' },  // Air Canada      — Frosted Ice Blue
    'FJI': { main: '#FFE5B4', glow: 'rgba(255, 229, 180, 0.60)' },  // Fiji Airways    — Sandy Ochre
    'HAL': { main: '#E280FF', glow: 'rgba(226, 128, 255, 0.65)' },  // Hawaiian Airlines — Bright Orchid Purple
    'ETD': { main: '#F5E6CC', glow: 'rgba(245, 230, 204, 0.60)' },  // Etihad Airways  — Warm Platinum
    'KLM': { main: '#00ddff', glow: 'rgba(0,   221, 255, 0.60)' },  // KLM             — Sky Blue
    'DLH': { main: '#ffcc00', glow: 'rgba(255, 204, 0,   0.60)' },  // Lufthansa       — Yellow
    'BAW': { main: '#3355cc', glow: 'rgba(51,  85,  204, 0.60)' },  // British Airways — Royal Blue
    'AAL': { main: '#c8d4e8', glow: 'rgba(200, 212, 232, 0.55)' },  // American Airlines — Cool Light Grey
    'ASA': { main: '#00b4b4', glow: 'rgba(0,   180, 180, 0.65)' },  // Alaska Airlines — Teal
  };

  function getHashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash);
  }

  function getAirlineIcao(flight, model) {
    if (!flight || flight === 'N/A') return null;
    const cleanFlight = flight.trim().toUpperCase();
    const prefixMatch = cleanFlight.match(/^([A-Z]+)/);
    if (!prefixMatch) return null;
    
    const prefix = prefixMatch[1];

    // Explicit QantasLink regional prefix check
    if (['QLK', 'SSQ', 'EAQ', 'NJE'].includes(prefix)) {
      return 'QLK';
    }

    // Differentiate Qantas Mainline vs QantasLink based on flight number or regional aircraft model
    if (prefix === 'QFA') {
      const match = cleanFlight.match(/^QFA(\d+)/);
      const num = match ? parseInt(match[1]) : 0;
      const cleanModel = model ? model.trim().toUpperCase() : '';
      const isRegionalModel = ['DH8D', 'DH8C', 'DH8A', 'DHC8', 'E190', 'BCS3', 'BCS1', 'B712', 'F100', 'F70', 'SF34', 'AT72', 'AT76'].includes(cleanModel);
      
      if (num >= 1200 || isRegionalModel) {
        return 'QLK';
      }
      return 'QFA';
    }
    
    if (prefix.length === 3) {
      return prefix;
    }
    
    if (prefix.length === 2) {
      // Look up IATA -> ICAO mapping
      if (window.AIRLINES) {
        const match = Object.entries(window.AIRLINES).find(([icao, info]) => info.iata === prefix);
        if (match) {
          return match[0]; // The key is the ICAO code
        }
      }
    }
    
    return null;
  }

  function getAircraftColors(flight, isTactical, model) {
    if (isTactical) {
      return { main: 'var(--military-red)', glow: 'var(--military-red-glow)' };
    }
    const icao = getAirlineIcao(flight, model);
    if (icao) {
      // 1. Check hardcoded primary colors first
      if (AIRLINE_COLORS[icao]) {
        return AIRLINE_COLORS[icao];
      }
      // 2. Generate deterministic bright HSL color for other airlines
      const hash = getHashCode(icao);
      let hue = hash % 360;
      // Shift away from red (0-25, 335-360) to reserve for military
      if (hue < 25 || hue > 335) {
        hue = (hue + 55) % 360;
      }
      return {
        main: `hsl(${hue}, 95%, 60%)`,
        glow: `hsla(${hue}, 95%, 60%, 0.6)`
      };
    }
    // Default cyan
    return { main: 'var(--hud-cyan)', glow: 'var(--hud-cyan-glow)' };
  }


  function getAircraftClass(model, isTactical, category, speed, alt) {
    // 1. If we have a valid model code, check with flexible prefix matching first
    if (model && model !== 'UNKN' && model !== 'N/A') {
      const code = model.trim().toUpperCase();
      
      // Super Jumbo Quad-Engine Airliners (A380, B747, A340, AN-124, A225)
      if (code.startsWith('A38') || code.startsWith('B74') || code.startsWith('A34') || ['AN124', 'A225', 'B52', 'C5'].includes(code)) {
        return 'super_jumbo';
      }
      // Turboprop check (DHC-8 / Dash 8 / ATR / King Air / Saab 340)
      if (code.startsWith('DH8') || code.startsWith('DHC') || code.startsWith('AT7') || code.startsWith('AT4') || code.startsWith('ATR') || code.includes('Q400') || code.includes('DASH') || ['SF34', 'JS41', 'B190', 'PC12', 'CN23', 'BE20', 'BE9L', 'B350'].includes(code)) {
        return 'turboprop';
      }
      // Fighters & Military Jets
      if (code.startsWith('F1') || code.startsWith('F2') || code.startsWith('F3') || code.startsWith('FA') || code.startsWith('SU') || code.startsWith('MIG') || ['TYF', 'RFL', 'T38', 'T45', 'A10'].includes(code)) {
        return 'fighter';
      }
      // Military Heavies
      if (['C17', 'C130', 'C30J', 'B1', 'B2', 'KC10', 'KC135', 'E3TF', 'P8', 'A400'].includes(code)) {
        return 'military_heavy';
      }
      // Large Widebody Twin-Engine Airliners (A350, B787, B777, A330, B767)
      if (code.startsWith('A33') || code.startsWith('A35') || code.startsWith('B76') || code.startsWith('B77') || code.startsWith('B78')) {
        return 'large_airliner';
      }
      // Standard Narrowbody Airliners (A320, A321, A319, A318, A20N, A21N, B737, B738, B739, B38M, E190, A220, B752)
      if (code.startsWith('A31') || code.startsWith('A32') || code.startsWith('A19') || code.startsWith('A20') || code.startsWith('A21') || code.startsWith('B73') || code.startsWith('B3') || code.startsWith('B75') || code.startsWith('BCS') || code.startsWith('E17') || code.startsWith('E19') || code.startsWith('E29') || code.startsWith('CRJ')) {
        return 'standard_airliner';
      }
      // Light General Aviation
      if (code.startsWith('C1') || code.startsWith('C2') || code.startsWith('PA') || code.startsWith('SR') || code.startsWith('DA') || code.startsWith('M20')) {
        return 'light';
      }
    }
    
    // 2. Fallback to ADS-B Emitter Category
    if (category) {
      const cat = String(category).trim().toUpperCase();
      if (cat === 'A1') return 'light';
      if (cat === 'A2' || cat === 'A3') return 'standard_airliner';
      if (cat === 'A4' || cat === 'A5') return 'large_airliner';
      if (cat === 'A6') return 'fighter';
      if (cat === 'A7') return 'light'; 
    }
    
    // 3. Fallback to tactical flag
    if (isTactical) {
      return 'fighter';
    }
    
    // 4. Fallback based on speed & altitude telemetry
    if (speed && speed > 0) {
      if (speed < 180 && alt < 12000) {
        return 'light';
      } else if (speed < 280 && alt < 20000) {
        return 'turboprop';
      } else if (speed > 520) {
        return 'fighter'; 
      } else if (speed > 350) {
        return speed > 460 ? 'large_airliner' : 'standard_airliner';
      }
    }
    
    // Default fallback is standard airliner rather than chevron default!
    return 'standard_airliner';
  }

  // Dot product based on bearing and track (checks if difference is closing)
  function getTransitStatus(bearing, track) {
    if (track === undefined || track === null) return 'INBOUND';
    const diff = (track - bearing + 360) % 360;
    return (diff > 90 && diff < 270) ? 'INBOUND' : 'OUTBOUND';
  }

  // 1. Quad-Engine Superjumbo Airliner (Airbus A380-800 & Boeing 747 - 4 Outboard Engine Pods)
  function drawSuperJumboIcon(ctx, size) {
    ctx.beginPath();
    // Parabolic Double-Deck Cockpit Nose (Medium Fuselage Width: 0.52 * size)
    ctx.moveTo(0, -size * 1.6);
    ctx.bezierCurveTo(-size * 0.20, -size * 1.6, -size * 0.26, -size * 1.1, -size * 0.26, -size * 0.45);
    
    // Left Wing Root
    ctx.lineTo(-size * 0.26, -size * 0.35);
    
    // Inboard Left Engine Nacelle (Engine #2 - Outboard at x = 0.68)
    ctx.lineTo(-size * 0.65, -size * 0.38); // Inlet
    ctx.lineTo(-size * 0.65, -size * 0.05); // Pod body
    ctx.lineTo(-size * 0.72, -size * 0.05);
    
    // Outboard Left Engine Nacelle (Engine #1 - Outboard at x = 1.25)
    ctx.lineTo(-size * 1.20, -size * 0.15); // Inlet
    ctx.lineTo(-size * 1.20, +size * 0.12); // Pod body
    ctx.lineTo(-size * 1.28, +size * 0.12);
    
    // Swept Long-Span Left Wing Leading Edge out to Wingtip
    ctx.lineTo(-size * 1.70, size * 0.05);
    
    // Wingtip Winglet / Wingtip Fence Cap
    ctx.bezierCurveTo(-size * 1.75, size * 0.12, -size * 1.70, size * 0.26, -size * 1.58, size * 0.24);
    
    // Left Wing Trailing Edge
    ctx.lineTo(-size * 0.26, size * 0.28);
    
    // Aft Fuselage Tube
    ctx.lineTo(-size * 0.20, size * 1.05);
    // Horizontal Tailplane Stabilizer
    ctx.lineTo(-size * 0.68, size * 1.35);
    ctx.lineTo(-size * 0.62, size * 1.48);
    ctx.lineTo(-size * 0.12, size * 1.35);
    
    // Tail Cone
    ctx.lineTo(0, size * 1.45);
    
    // Right side (Mirrored)
    ctx.lineTo(size * 0.12, size * 1.35);
    ctx.lineTo(size * 0.62, size * 1.48);
    ctx.lineTo(size * 0.68, size * 1.35);
    ctx.lineTo(size * 0.20, size * 1.05);
    
    ctx.lineTo(size * 0.26, size * 0.28);
    ctx.bezierCurveTo(size * 1.58, size * 0.24, size * 1.70, size * 0.12, size * 1.75, size * 0.05);
    
    // Right Outboard Engine (Engine #4)
    ctx.lineTo(size * 1.28, size * 0.12);
    ctx.lineTo(size * 1.20, size * 0.12);
    ctx.lineTo(size * 1.20, -size * 0.15);
    
    // Right Inboard Engine (Engine #3)
    ctx.lineTo(size * 0.72, -size * 0.05);
    ctx.lineTo(size * 0.65, -size * 0.05);
    ctx.lineTo(size * 0.65, -size * 0.38);
    ctx.lineTo(size * 0.26, -size * 0.35);
    ctx.lineTo(size * 0.26, -size * 0.45);
    
    ctx.bezierCurveTo(size * 0.26, -size * 1.1, size * 0.20, -size * 1.6, 0, -size * 1.6);
    ctx.closePath();
  }

  // 2. Fighter Jet (F-16 / F-18 / F-35 Delta Wing)
  function drawFighterIcon(ctx, size) {
    ctx.beginPath();
    ctx.moveTo(0, -size * 1.45); // Sharp radome nose
    ctx.lineTo(-size * 0.14, -size * 0.7);
    ctx.lineTo(-size * 0.24, -size * 0.35); // LERX
    
    // Swept Delta Wing
    ctx.lineTo(-size * 1.18, size * 0.25);
    ctx.lineTo(-size * 1.15, size * 0.42);  // Wingtip trailing edge
    ctx.lineTo(-size * 0.22, size * 0.28);  // Wing root trailing edge
    
    // Aft Fuselage & Twin Tail Fins
    ctx.lineTo(-size * 0.20, size * 0.9);
    ctx.lineTo(-size * 0.58, size * 1.25);  // Twin tail fin tip
    ctx.lineTo(-size * 0.54, size * 1.38);
    ctx.lineTo(-size * 0.14, size * 1.15);  // Engine nozzle Left
    ctx.lineTo(-size * 0.12, size * 1.28);
    ctx.lineTo(0, size * 1.18);             // Engine divider
    
    // Right side (Mirrored)
    ctx.lineTo(size * 0.12, size * 1.28);
    ctx.lineTo(size * 0.14, size * 1.15);
    ctx.lineTo(size * 0.54, size * 1.38);
    ctx.lineTo(size * 0.58, size * 1.25);
    ctx.lineTo(size * 0.20, size * 0.9);
    ctx.lineTo(size * 0.22, size * 0.28);
    ctx.lineTo(size * 1.15, size * 0.42);
    ctx.lineTo(size * 1.18, size * 0.25);
    ctx.lineTo(size * 0.24, -size * 0.35);
    ctx.lineTo(size * 0.14, -size * 0.7);
    ctx.closePath();
  }

  // 3. Large Widebody Airliner (B77W / B789 / A359 / A332 - Medium Fuselage, Outboard Engines)
  function drawLargeAirlinerIcon(ctx, size) {
    ctx.beginPath();
    // Rounded Cockpit Nose (Fuselage Width: 0.48 * size)
    ctx.moveTo(0, -size * 1.55);
    ctx.bezierCurveTo(-size * 0.18, -size * 1.55, -size * 0.24, -size * 1.1, -size * 0.24, -size * 0.45);
    
    // Left Wing Root
    ctx.lineTo(-size * 0.24, -size * 0.35);
    
    // Outboard Underwing Engine Pod Nacelle (Mounted at x = 0.70)
    ctx.lineTo(-size * 0.65, -size * 0.35); // Inlet
    ctx.lineTo(-size * 0.65, -size * 0.05); // Engine housing
    ctx.lineTo(-size * 0.72, -size * 0.05);
    
    // Swept Long-Span Left Wing Leading Edge
    ctx.lineTo(-size * 1.55, size * 0.05);
    // Raked Wingtip Cap
    ctx.bezierCurveTo(-size * 1.60, size * 0.12, -size * 1.55, size * 0.24, -size * 1.45, size * 0.22);
    // Left Wing Trailing Edge
    ctx.lineTo(-size * 0.24, size * 0.25);
    
    // Aft Fuselage Tube
    ctx.lineTo(-size * 0.18, size * 1.05);
    // Horizontal Tailplane Stabilizer
    ctx.lineTo(-size * 0.62, size * 1.32);
    ctx.lineTo(-size * 0.58, size * 1.45);
    ctx.lineTo(-size * 0.12, size * 1.32);
    ctx.lineTo(0, size * 1.42); // Tail cone
    
    // Right side (Mirrored)
    ctx.lineTo(size * 0.12, size * 1.32);
    ctx.lineTo(size * 0.58, size * 1.45);
    ctx.lineTo(size * 0.62, size * 1.32);
    ctx.lineTo(size * 0.18, size * 1.05);
    
    ctx.lineTo(size * 0.24, size * 0.25);
    ctx.bezierCurveTo(size * 1.55, size * 0.24, size * 1.60, size * 0.12, size * 1.55, size * 0.05);
    ctx.lineTo(size * 0.72, -size * 0.05);
    ctx.lineTo(size * 0.65, -size * 0.05);
    ctx.lineTo(size * 0.65, -size * 0.35);
    ctx.lineTo(size * 0.24, -size * 0.35);
    ctx.lineTo(size * 0.24, -size * 0.45);
    ctx.bezierCurveTo(size * 0.24, -size * 1.1, size * 0.18, -size * 1.55, 0, -size * 1.55);
    ctx.closePath();
  }

  // 4. Standard Narrowbody Airliner (B738 / A320 / A21N - Medium Fuselage, Outboard Engines)
  function drawStandardAirlinerIcon(ctx, size) {
    ctx.beginPath();
    // Rounded Cockpit Nose (Fuselage Width: 0.42 * size)
    ctx.moveTo(0, -size * 1.45);
    ctx.bezierCurveTo(-size * 0.16, -size * 1.45, -size * 0.21, -size * 1.0, -size * 0.21, -size * 0.40);
    
    // Outboard Underwing Turbofan Nacelle Pod (Mounted at x = 0.62)
    ctx.lineTo(-size * 0.56, -size * 0.32); // Engine inlet
    ctx.lineTo(-size * 0.56, -size * 0.02); // Engine housing
    ctx.lineTo(-size * 0.63, -size * 0.02);
    
    // Swept Left Wing Leading Edge out to Wingtip
    ctx.lineTo(-size * 1.40, size * 0.05);
    
    // Left Wingtip Cap (Winglet extension)
    ctx.bezierCurveTo(-size * 1.44, size * 0.10, -size * 1.40, size * 0.22, -size * 1.28, size * 0.22);
    
    // Swept Left Wing Trailing Edge
    ctx.lineTo(-size * 0.21, size * 0.25);
    
    // Fuselage Tube to Tail
    ctx.lineTo(-size * 0.16, size * 1.0);
    
    // Left Horizontal Stabilizer (Tailplane)
    ctx.lineTo(-size * 0.56, size * 1.25);
    ctx.lineTo(-size * 0.52, size * 1.38);
    ctx.lineTo(-size * 0.10, size * 1.26);
    
    // Tail Cone
    ctx.lineTo(0, size * 1.35);
    
    // Right side (Mirrored)
    ctx.lineTo(size * 0.10, size * 1.26);
    ctx.lineTo(size * 0.52, size * 1.38);
    ctx.lineTo(size * 0.56, size * 1.25);
    ctx.lineTo(size * 0.16, size * 1.0);
    
    ctx.lineTo(size * 0.21, size * 0.25);
    ctx.bezierCurveTo(size * 1.40, size * 0.22, size * 1.44, size * 0.10, size * 1.40, size * 0.05);
    
    ctx.lineTo(size * 0.63, -size * 0.02);
    ctx.lineTo(size * 0.56, -size * 0.02);
    ctx.lineTo(size * 0.56, -size * 0.32);
    ctx.lineTo(size * 0.21, -size * 0.40);
    
    ctx.bezierCurveTo(size * 0.21, -size * 1.0, size * 0.16, -size * 1.45, 0, -size * 1.45);
    ctx.closePath();
  }

  // 5. Turboprop Airliner (DHC-8 Dash 8 / ATR 72 - High Straight Wing, Outboard Prop Nacelles)
  function drawTurbopropIcon(ctx, size) {
    ctx.beginPath();
    // Slender Regional Fuselage Nose (Fuselage Width: 0.36 * size)
    ctx.moveTo(0, -size * 1.45);
    ctx.quadraticCurveTo(-size * 0.15, -size * 1.2, -size * 0.18, -size * 0.2);
    
    // High-Wing Extension (Straight unswept high-aspect wing, 90° to fuselage)
    // Left Engine Nacelle (Mounted Outboard at x = 0.52)
    ctx.lineTo(-size * 0.46, -size * 0.42); // Left prop spinner tip
    ctx.lineTo(-size * 0.54, -size * 0.42);
    ctx.lineTo(-size * 0.54, size * 0.20);  // Engine nacelle housing extending behind wing
    ctx.lineTo(-size * 0.46, size * 0.20);
    ctx.lineTo(-size * 0.18, -size * 0.08); // Wing root leading edge
    
    // High-Aspect Straight Wing out to Wingtip
    ctx.lineTo(-size * 1.48, -size * 0.08); // Straight Wing Leading Edge
    ctx.lineTo(-size * 1.48, size * 0.12);   // Square Wingtip
    ctx.lineTo(-size * 0.18, size * 0.12);   // Straight Wing Trailing Edge
    
    // Fuselage Tube to T-Tail
    ctx.lineTo(-size * 0.14, size * 1.15);
    // T-Tail Horizontal Stabilizer (Top of Fin)
    ctx.lineTo(-size * 0.58, size * 1.30);  // Left T-Tail tip
    ctx.lineTo(-size * 0.52, size * 1.42);
    ctx.lineTo(0, size * 1.35);             // Tail cap
    
    // Right side (Mirrored)
    ctx.lineTo(size * 0.52, size * 1.42);
    ctx.lineTo(size * 0.58, size * 1.30);
    ctx.lineTo(size * 0.14, size * 1.15);
    ctx.lineTo(size * 0.18, size * 0.12);
    ctx.lineTo(size * 1.48, size * 0.12);
    ctx.lineTo(size * 1.48, -size * 0.08);
    ctx.lineTo(size * 0.18, -size * 0.08);
    ctx.lineTo(size * 0.46, size * 0.20);
    ctx.lineTo(size * 0.54, size * 0.20);
    ctx.lineTo(size * 0.54, -size * 0.42);
    ctx.lineTo(size * 0.46, -size * 0.42);
    ctx.lineTo(size * 0.18, -size * 0.2);
    ctx.quadraticCurveTo(size * 0.15, -size * 1.2, 0, -size * 1.45);
    ctx.closePath();
  }

  // 6. Light General Aviation (Cessna / Cirrus GA - Realistic Planform)
  function drawLightIcon(ctx, size) {
    ctx.beginPath();
    ctx.moveTo(0, -size * 1.25); // Propeller spinner
    ctx.lineTo(-size * 0.14, -size * 1.0);
    ctx.lineTo(-size * 0.14, -size * 0.20);
    
    // Straight GA Wing
    ctx.lineTo(-size * 1.18, -size * 0.20);
    ctx.lineTo(-size * 1.18, size * 0.08); // GA Wingtip
    ctx.lineTo(-size * 0.14, size * 0.08);
    
    // Fuselage to Tail
    ctx.lineTo(-size * 0.10, size * 0.85);
    ctx.lineTo(-size * 0.40, size * 1.10); // Horizontal stabilizer
    ctx.lineTo(-size * 0.36, size * 1.22);
    ctx.lineTo(0, size * 1.10);
    
    // Right side (Mirrored)
    ctx.lineTo(size * 0.36, size * 1.22);
    ctx.lineTo(size * 0.40, size * 1.10);
    ctx.lineTo(size * 0.10, size * 0.85);
    ctx.lineTo(size * 0.14, size * 0.08);
    ctx.lineTo(size * 1.18, size * 0.08);
    ctx.lineTo(size * 1.18, -size * 0.20);
    ctx.lineTo(size * 0.14, -size * 0.20);
    ctx.lineTo(size * 0.14, -size * 1.0);
    ctx.closePath();
  }

  // 7. Default Fallback Icon
  function drawDefaultIcon(ctx, size) {
    drawStandardAirlinerIcon(ctx, size);
  }

  // Landmarks Mapping
  const LANDMARKS = [
    { name: "YSSY (SYDNEY TOWER)", lat: -33.94611, lon: 151.17722 }
  ];

  function drawLandmarks(cx, cy, maxRadius) {
    const rangeFilter = state.radarRangeFilter;
    LANDMARKS.forEach(lm => {
      const distance = getDistanceNM(state.receiverLat, state.receiverLon, lm.lat, lm.lon);
      if (distance <= rangeFilter) {
        const bearing = getBearingDegrees(state.receiverLat, state.receiverLon, lm.lat, lm.lon);
        const r = (distance / rangeFilter) * maxRadius;
        const angleRad = (bearing * Math.PI / 180) - (Math.PI / 2);
        const lx = cx + r * Math.cos(angleRad);
        const ly = cy + r * Math.sin(angleRad);
        
        // Draw YSSY Landmark
        radarCtx.save();
        radarCtx.shadowBlur = 6;
        radarCtx.shadowColor = '#d5a021';
        radarCtx.strokeStyle = '#d5a021';
        radarCtx.fillStyle = '#d5a021';
        radarCtx.lineWidth = 1.8;
        
        radarCtx.beginPath();
        radarCtx.arc(lx, ly, 4, 0, Math.PI * 2);
        radarCtx.stroke();
        
        // Crosshair ticks
        radarCtx.beginPath();
        radarCtx.moveTo(lx - 7, ly);
        radarCtx.lineTo(lx + 7, ly);
        radarCtx.moveTo(lx, ly - 7);
        radarCtx.lineTo(lx, ly + 7);
        radarCtx.stroke();
        
        radarCtx.fillStyle = 'rgba(213, 160, 33, 0.95)';
        radarCtx.font = 'bold 22px var(--font-tech)';
        radarCtx.shadowBlur = 14;
        radarCtx.shadowColor = '#d5a021';
        radarCtx.textAlign = 'left';
        radarCtx.textBaseline = 'middle';
        radarCtx.fillText(lm.name, lx + 16, ly);
        radarCtx.restore();
      }
    });
  }

  // --- 1. Starfield Engine (Canvas-based deep space twinkling) ---
  const starfieldCanvas = document.getElementById('starfield');
  const starfieldContext = starfieldCanvas.getContext('2d');
  let stars = [];

  function resizeStarfield() {
    starfieldCanvas.width = window.innerWidth;
    starfieldCanvas.height = window.innerHeight;
    generateStars();
  }

  function generateStars() {
    stars = [];
    const count = parseInt(state.starCount);
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * starfieldCanvas.width,
        y: Math.random() * starfieldCanvas.height,
        // z represents depth layers (1 = far, 3 = near)
        z: Math.random() * 2 + 1,
        // Twinkling speed and phase
        speed: (Math.random() * 0.02 + 0.005) * (state.starSpeed / 15),
        twinklePhase: Math.random() * Math.PI * 2,
        baseOpacity: Math.random() * 0.6 + 0.2,
        // Size proportional to depth
        size: Math.random() * 1.2 + 0.2
      });
    }
  }

  // Constellations database
  const CONSTELLATIONS = [
    {
      name: "SOUTHERN CROSS (CRUX)",
      stars: [
        { x: 0.15, y: 0.45, id: 'acrux' },
        { x: 0.15, y: 0.25, id: 'gacrux' },
        { x: 0.10, y: 0.35, id: 'mimosa' },
        { x: 0.20, y: 0.37, id: 'decrux' },
        { x: 0.18, y: 0.41, id: 'eps_cru' }
      ],
      connections: [
        ['acrux', 'gacrux'],
        ['mimosa', 'decrux']
      ],
      color: 'rgba(0, 240, 255, 0.22)',
      textColor: 'rgba(0, 240, 255, 0.45)'
    },
    {
      name: "ORION THE HUNTER",
      stars: [
        { x: 0.45, y: 0.35, id: 'betelgeuse' },
        { x: 0.55, y: 0.55, id: 'rigel' },
        { x: 0.43, y: 0.53, id: 'bellatrix' },
        { x: 0.57, y: 0.37, id: 'saiph' },
        { x: 0.49, y: 0.45, id: 'alnitak' },
        { x: 0.50, y: 0.46, id: 'alnilam' },
        { x: 0.51, y: 0.47, id: 'mintaka' }
      ],
      connections: [
        ['betelgeuse', 'alnitak'],
        ['bellatrix', 'mintaka'],
        ['alnitak', 'alnilam'],
        ['alnilam', 'mintaka'],
        ['alnitak', 'saiph'],
        ['mintaka', 'rigel'],
        ['saiph', 'rigel'],
        ['betelgeuse', 'bellatrix']
      ],
      color: 'rgba(0, 255, 102, 0.22)',
      textColor: 'rgba(0, 255, 102, 0.45)'
    },
    {
      name: "URSA MAJOR (BIG DIPPER)",
      stars: [
        { x: 0.75, y: 0.30, id: 'dubhe' },
        { x: 0.77, y: 0.40, id: 'merak' },
        { x: 0.83, y: 0.42, id: 'phecda' },
        { x: 0.82, y: 0.32, id: 'megrez' },
        { x: 0.87, y: 0.28, id: 'alioth' },
        { x: 0.91, y: 0.24, id: 'mizar' },
        { x: 0.94, y: 0.22, id: 'alkaid' }
      ],
      connections: [
        ['dubhe', 'merak'],
        ['merak', 'phecda'],
        ['phecda', 'megrez'],
        ['megrez', 'dubhe'],
        ['megrez', 'alioth'],
        ['alioth', 'mizar'],
        ['mizar', 'alkaid']
      ],
      color: 'rgba(122, 180, 255, 0.22)',
      textColor: 'rgba(122, 180, 255, 0.45)'
    }
  ];

  // Satellites database
  let satellites = [
    { name: "ISS (INTL SPACE STATION)", speed: 0.45, x: 100, y: 150, angle: 0.15, color: '#ffcc00', alt: '254 mi', vel: '17,150 mph' },
    { name: "STARLINK-3912", speed: 0.65, x: 400, y: 300, angle: 0.35, color: '#00f0ff', alt: '341 mi', vel: '16,840 mph' },
    { name: "HUBBLE SPACE TELESCOPE", speed: 0.35, x: 200, y: 500, angle: -0.15, color: '#00ff66', alt: '335 mi', vel: '16,900 mph' }
  ];

  state.celestialDrift = 0;

  function resetSatellite(sat, w, h) {
    const edge = Math.floor(Math.random() * 4);
    sat.speed = (Math.random() * 0.4 + 0.2); // Slow crawling speeds look much more realistic on a ceiling!
    
    const names = ["ISS", "HUBBLE HST", "TIANGONG SPACE STATION", "STARLINK-4122", "STARLINK-5102", "STARLINK-1982", "STARLINK-3810", "ENVISAT", "NOAA-19"];
    sat.name = names[Math.floor(Math.random() * names.length)];
    
    sat.alt = (Math.floor(Math.random() * 150) + 200) + ' mi';
    sat.vel = (Math.floor(Math.random() * 500) + 16700).toLocaleString() + ' mph';
    
    if (sat.name.startsWith("STARLINK")) {
      sat.color = '#00f0ff'; // Cyan
    } else if (sat.name === "ISS" || sat.name.includes("TIANGONG")) {
      sat.color = '#ffcc00'; // Gold/Yellow
    } else {
      sat.color = '#00ff66'; // Green
    }
    
    if (edge === 0) { // Left
      sat.x = -80;
      sat.y = Math.random() * h;
      sat.angle = Math.random() * Math.PI / 4 - Math.PI / 8;
    } else if (edge === 1) { // Right
      sat.x = w + 80;
      sat.y = Math.random() * h;
      sat.angle = Math.PI - (Math.random() * Math.PI / 4 - Math.PI / 8);
    } else if (edge === 2) { // Top
      sat.x = Math.random() * w;
      sat.y = -80;
      sat.angle = Math.PI / 2 + (Math.random() * Math.PI / 4 - Math.PI / 8);
    } else { // Bottom
      sat.x = Math.random() * w;
      sat.y = h + 80;
      sat.angle = -Math.PI / 2 + (Math.random() * Math.PI / 4 - Math.PI / 8);
    }
  }

  function drawConstellations() {
    const w = starfieldCanvas.width;
    const h = starfieldCanvas.height;
    
    CONSTELLATIONS.forEach(c => {
      const mappedStars = {};
      
      c.stars.forEach(s => {
        // Celestial drift applied to stars
        const sx = (s.x * w + state.celestialDrift + w * 2) % w;
        const sy = s.y * h;
        mappedStars[s.id] = { x: sx, y: sy };
        
        // Render constellation star (clean crisp core)
        starfieldContext.fillStyle = '#ffffff';
        starfieldContext.beginPath();
        starfieldContext.arc(sx, sy, 2.8, 0, Math.PI * 2);
        starfieldContext.fill();
      });
      
      // Draw connection vectors
      starfieldContext.save();
      starfieldContext.strokeStyle = c.color;
      starfieldContext.lineWidth = 1.0;
      starfieldContext.setLineDash([2, 4]);
      
      c.connections.forEach(conn => {
        const pt1 = mappedStars[conn[0]];
        const pt2 = mappedStars[conn[1]];
        
        if (pt1 && pt2) {
          if (Math.abs(pt1.x - pt2.x) < w * 0.5) {
            starfieldContext.beginPath();
            starfieldContext.moveTo(pt1.x, pt1.y);
            starfieldContext.lineTo(pt2.x, pt2.y);
            starfieldContext.stroke();
          }
        }
      });
      starfieldContext.restore();
      
      // Draw name label in the center of geometry
      let avgX = 0;
      let avgY = 0;
      c.stars.forEach(s => {
        avgX += mappedStars[s.id].x;
        avgY += mappedStars[s.id].y;
      });
      avgX /= c.stars.length;
      avgY /= c.stars.length;
      
      starfieldContext.save();
      starfieldContext.fillStyle = c.textColor;
      starfieldContext.font = 'bold 22px var(--font-tech)';
      starfieldContext.textAlign = 'center';
      starfieldContext.textBaseline = 'middle';
      starfieldContext.fillText(c.name, avgX, avgY - 22);
      
      // Small locator crosshair
      starfieldContext.strokeStyle = c.color;
      starfieldContext.lineWidth = 0.8;
      starfieldContext.beginPath();
      starfieldContext.moveTo(avgX - 4, avgY);
      starfieldContext.lineTo(avgX + 4, avgY);
      starfieldContext.moveTo(avgX, avgY - 4);
      starfieldContext.lineTo(avgX, avgY + 4);
      starfieldContext.stroke();
      starfieldContext.restore();
    });
  }

  function updateAndDrawSatellites() {
    const w = starfieldCanvas.width;
    const h = starfieldCanvas.height;
    
    satellites.forEach(sat => {
      sat.x += sat.speed * Math.cos(sat.angle);
      sat.y += sat.speed * Math.sin(sat.angle);
      
      if (sat.x > w + 100 || sat.x < -100 || sat.y > h + 100 || sat.y < -100) {
        resetSatellite(sat, w, h);
      }
      
      starfieldContext.save();
      starfieldContext.strokeStyle = sat.color;
      starfieldContext.fillStyle = sat.color;
      starfieldContext.lineWidth = 1.2;
      
      const x = sat.x;
      const y = sat.y;
      
      starfieldContext.beginPath();
      starfieldContext.arc(x, y, 2.5, 0, Math.PI * 2);
      starfieldContext.fill();
      
      starfieldContext.beginPath();
      starfieldContext.moveTo(x - 7, y);
      starfieldContext.lineTo(x + 7, y);
      starfieldContext.moveTo(x, y - 2);
      starfieldContext.lineTo(x, y + 2);
      starfieldContext.stroke();
      
      starfieldContext.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      starfieldContext.beginPath();
      starfieldContext.moveTo(x + 5, y - 5);
      starfieldContext.lineTo(x + 20, y - 18);
      starfieldContext.lineTo(x + 55, y - 18);
      starfieldContext.stroke();
      
      starfieldContext.fillStyle = 'rgba(224, 247, 252, 0.85)';
      starfieldContext.font = 'bold 20px var(--font-tech)';
      starfieldContext.textAlign = 'left';
      starfieldContext.fillText(sat.name, x + 24, y - 26);
      
      starfieldContext.font = '16px var(--font-tech)';
      starfieldContext.fillStyle = 'rgba(200, 225, 235, 0.7)';
      starfieldContext.fillText(`ALT: ${sat.alt} | VEL: ${sat.vel} | LEO`, x + 24, y - 6);
      
      starfieldContext.restore();
    });
  }

  function drawStarfield() {
    starfieldContext.fillStyle = '#020205';
    starfieldContext.fillRect(0, 0, starfieldCanvas.width, starfieldCanvas.height);
    
    // Update global celestial drift offset locked to rotation speed
    state.celestialDrift = (state.celestialDrift - (state.starSpeed / 200) * 0.05) % starfieldCanvas.width;
    
    const count = stars.length;
    for (let i = 0; i < count; i++) {
      const star = stars[i];
      
      // Update twinkle phase
      star.twinklePhase += star.speed;
      const opacity = Math.max(0.1, star.baseOpacity + Math.sin(star.twinklePhase) * 0.3);
      
      // Draw star
      starfieldContext.fillStyle = `rgba(224, 247, 252, ${opacity})`;
      starfieldContext.beginPath();
      // Draw as a circular point
      starfieldContext.arc(star.x, star.y, star.size * star.z, 0, Math.PI * 2);
      starfieldContext.fill();
      
      // Slowly drift stars (simulating Earth rotation)
      star.x -= (state.starSpeed / 100) * 0.05 * star.z;
      if (star.x < 0) {
        star.x = starfieldCanvas.width;
        star.y = Math.random() * starfieldCanvas.height;
      }
    }
    
    // Draw Constellations drifting in sync with stars
    drawConstellations();
    
    // Update & Draw LEO Satellites traversing LEO paths
    updateAndDrawSatellites();
  }

  // --- 2. Polar Coordinates Math (Haversine & Bearing calculations) ---
  
  // Calculate distance in Nautical Miles between two points (Haversine)
  function getDistanceNM(lat1, lon1, lat2, lon2) {
    const R = 3440.065; // Radius of earth in Nautical Miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  // Calculate bearing from receiver to aircraft (0 to 360 degrees)
  function getBearingDegrees(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    
    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
              Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
              
    let bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360;
  }

  // --- 3. Radar Dome Canvas Renderer ---
  const radarCanvas = document.getElementById('radar-canvas');
  const radarCtx = radarCanvas.getContext('2d');
  let radarViewportSize = 0;

  function resizeRadar() {
    const parent = radarCanvas.parentElement;
    radarViewportSize = parent.clientWidth;
    radarCanvas.width = radarViewportSize;
    radarCanvas.height = radarViewportSize;
  }

  function drawRadar() {
    // Clear canvas
    radarCtx.clearRect(0, 0, radarViewportSize, radarViewportSize);
    
    const cx = radarViewportSize / 2;
    const cy = radarViewportSize / 2;
    const maxRadius = (radarViewportSize / 2) * 0.95; // Leave small margin for border ticks
    
    // Draw Radar Sweeping Grid & Rings
    drawRadarGrid(cx, cy, maxRadius);
    
    // Draw aircraft histories/trails
    drawAircraftTrails(cx, cy, maxRadius);
    
    // Draw Landmarks (Sydney Tower)
    drawLandmarks(cx, cy, maxRadius);
    
    // Draw plane markers
    drawAircraftMarkers(cx, cy, maxRadius);
    
    // Draw Radar Sweep Line
    drawRadarSweep(cx, cy, maxRadius);
  }


  function drawRadarGrid(cx, cy, maxRadius) {
    // Range lines configuration
    const rangeFilter = state.radarRangeFilter;
    const rings = 4; // Number of concentric rings
    
    radarCtx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
    radarCtx.lineWidth = 1;
    
    // Draw Concentric Range Rings
    for (let i = 1; i <= rings; i++) {
      const radius = (i / rings) * maxRadius;
      radarCtx.beginPath();
      radarCtx.arc(cx, cy, radius, 0, Math.PI * 2);
      radarCtx.stroke();
      
      // Range Ring Text Labels (e.g. 25 NM, 50 NM)
      radarCtx.fillStyle = 'rgba(0, 240, 255, 0.4)';
      radarCtx.font = `bold 10px var(--font-tech)`;
      radarCtx.textAlign = 'center';
      radarCtx.fillText(`${Math.round((i / rings) * rangeFilter)} NM`, cx, cy - radius + 12);
    }
    
    // Draw Crosshair Cross lines
    radarCtx.beginPath();
    // Horizontal Line
    radarCtx.moveTo(cx - maxRadius, cy);
    radarCtx.lineTo(cx + maxRadius, cy);
    // Vertical Line
    radarCtx.moveTo(cx, cy - maxRadius);
    radarCtx.lineTo(cx, cy + maxRadius);
    radarCtx.stroke();
    
    // Draw Diagonal reference grid lines (45 deg, 135 deg, etc.)
    radarCtx.strokeStyle = 'rgba(0, 240, 255, 0.03)';
    radarCtx.beginPath();
    for (let angle = 45; angle < 180; angle += 45) {
      const rad = angle * Math.PI / 180;
      const dx = maxRadius * Math.sin(rad);
      const dy = maxRadius * Math.cos(rad);
      radarCtx.moveTo(cx - dx, cy - dy);
      radarCtx.lineTo(cx + dx, cy + dy);
    }
    radarCtx.stroke();
    
    // Draw compass degree tick marks on outer rim
    radarCtx.strokeStyle = 'rgba(0, 240, 255, 0.2)';
    radarCtx.lineWidth = 1.5;
    for (let angle = 0; angle < 360; angle += 10) {
      const rad = angle * Math.PI / 180;
      const tickStart = maxRadius;
      const tickEnd = maxRadius + (angle % 30 === 0 ? 8 : 4);
      
      radarCtx.beginPath();
      radarCtx.moveTo(cx + tickStart * Math.sin(rad), cy - tickStart * Math.cos(rad));
      radarCtx.lineTo(cx + tickEnd * Math.sin(rad), cy - tickEnd * Math.cos(rad));
      radarCtx.stroke();
      
      // Draw numbers for 30 deg intervals
      if (angle % 30 === 0) {
        radarCtx.fillStyle = 'rgba(0, 240, 255, 0.6)';
        radarCtx.font = '8px var(--font-tech)';
        radarCtx.textAlign = 'center';
        radarCtx.textBaseline = 'middle';
        
        const textDist = maxRadius + 16;
        const textVal = String(angle).padStart(3, '0');
        radarCtx.fillText(textVal, cx + textDist * Math.sin(rad), cy - textDist * Math.cos(rad));
      }
    }
    
    // Compass Cardinal directions N, S, E, W
    radarCtx.fillStyle = 'var(--hud-cyan)';
    radarCtx.font = 'bold 12px var(--font-tech)';
    radarCtx.textAlign = 'center';
    radarCtx.textBaseline = 'middle';
    
    radarCtx.fillText('N', cx, cy - maxRadius - 10);
    radarCtx.fillText('S', cx, cy + maxRadius + 10);
    radarCtx.fillText('E', cx + maxRadius + 10, cy);
    radarCtx.fillText('W', cx - maxRadius - 10, cy);
  }

  function drawRadarSweep(cx, cy, maxRadius) {
    // Increment sweep angle
    state.radarSweepAngle = (state.radarSweepAngle + 0.006) % (Math.PI * 2);
    
    // Ticking audio ping on N crossover
    const lastAngle = (state.radarSweepAngle - 0.006 + Math.PI * 2) % (Math.PI * 2);
    if (lastAngle < Math.PI * 2 && state.radarSweepAngle >= 0 && lastAngle > Math.PI * 1.95) {
      playSound('sonar');
    }
    
    // Draw sweeping arc gradient
    const sweepWidth = 0.4; // width of sweep fade in radians
    
    radarCtx.save();
    
    // Create conical sweep wedge
    radarCtx.beginPath();
    radarCtx.moveTo(cx, cy);
    radarCtx.arc(cx, cy, maxRadius, state.radarSweepAngle - sweepWidth, state.radarSweepAngle);
    radarCtx.closePath();
    
    // Soft glow radial gradient inside the sweep
    const grad = radarCtx.createRadialGradient(cx, cy, 10, cx, cy, maxRadius);
    grad.addColorStop(0, 'rgba(0, 240, 255, 0.15)');
    grad.addColorStop(1, 'rgba(0, 240, 255, 0.0)');
    
    // Apply sweep sector styling
    radarCtx.fillStyle = grad;
    radarCtx.fill();
    
    // Draw sweep lines
    radarCtx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
    radarCtx.lineWidth = 1.5;
    radarCtx.beginPath();
    radarCtx.moveTo(cx, cy);
    radarCtx.lineTo(cx + maxRadius * Math.cos(state.radarSweepAngle), cy + maxRadius * Math.sin(state.radarSweepAngle));
    radarCtx.stroke();
    
    radarCtx.restore();
  }

  function drawAircraftTrails(cx, cy, maxRadius) {
    const rangeFilter = state.radarRangeFilter;
    
    Object.values(state.aircraft).forEach(plane => {
      if (!plane.lat || !plane.lon || !plane.history || plane.history.length < 2) return;
      
      const distance = getDistanceNM(state.receiverLat, state.receiverLon, plane.lat, plane.lon);
      if (distance > rangeFilter) return;

      const isTactical = plane.isTactical;
      
      radarCtx.beginPath();
      
      // Plot history points
      plane.history.forEach((histPt, idx) => {
        const ptDist = getDistanceNM(state.receiverLat, state.receiverLon, histPt.lat, histPt.lon);
        const ptBearing = getBearingDegrees(state.receiverLat, state.receiverLon, histPt.lat, histPt.lon);
        
        // Convert to screen xy
        const ptRad = (ptDist / rangeFilter) * maxRadius;
        const ptAngle = (ptBearing * Math.PI / 180) - (Math.PI / 2);
        
        const ptX = cx + ptRad * Math.cos(ptAngle);
        const ptY = cy + ptRad * Math.sin(ptAngle);
        
        if (idx === 0) {
          radarCtx.moveTo(ptX, ptY);
        } else {
          radarCtx.lineTo(ptX, ptY);
        }
      });
      
      // Draw faded path
      const trailGrad = radarCtx.createLinearGradient(
        cx + ((getDistanceNM(state.receiverLat, state.receiverLon, plane.history[0].lat, plane.history[0].lon) / rangeFilter) * maxRadius) * Math.cos((getBearingDegrees(state.receiverLat, state.receiverLon, plane.history[0].lat, plane.history[0].lon) * Math.PI / 180) - (Math.PI / 2)),
        cy + ((getDistanceNM(state.receiverLat, state.receiverLon, plane.history[0].lat, plane.history[0].lon) / rangeFilter) * maxRadius) * Math.sin((getBearingDegrees(state.receiverLat, state.receiverLon, plane.history[0].lat, plane.history[0].lon) * Math.PI / 180) - (Math.PI / 2)),
        cx + ((distance / rangeFilter) * maxRadius) * Math.cos((getBearingDegrees(state.receiverLat, state.receiverLon, plane.lat, plane.lon) * Math.PI / 180) - (Math.PI / 2)),
        cy + ((distance / rangeFilter) * maxRadius) * Math.sin((getBearingDegrees(state.receiverLat, state.receiverLon, plane.lat, plane.lon) * Math.PI / 180) - (Math.PI / 2))
      );
      
      if (isTactical) {
        trailGrad.addColorStop(0, 'rgba(255, 51, 68, 0.01)');
        trailGrad.addColorStop(1, 'rgba(255, 51, 68, 0.3)');
        radarCtx.strokeStyle = trailGrad;
      } else {
        trailGrad.addColorStop(0, 'rgba(0, 240, 255, 0.01)');
        trailGrad.addColorStop(1, 'rgba(0, 240, 255, 0.3)');
        radarCtx.strokeStyle = trailGrad;
      }
      
      radarCtx.lineWidth = 1.5;
      radarCtx.setLineDash([2, 4]); // Dashed trails look super technical!
      radarCtx.stroke();
      radarCtx.setLineDash([]); // Reset
    });
  }

  function drawAircraftMarkers(cx, cy, maxRadius) {
    const rangeFilter = state.radarRangeFilter;
    const now = Date.now();
    
    Object.values(state.aircraft).forEach(plane => {
      if (!plane.lat || !plane.lon) return;
      
      const distance = getDistanceNM(state.receiverLat, state.receiverLon, plane.lat, plane.lon);
      if (distance > rangeFilter) return;
      
      const bearing = getBearingDegrees(state.receiverLat, state.receiverLon, plane.lat, plane.lon);
      const r = (distance / rangeFilter) * maxRadius;
      const angleRad = (bearing * Math.PI / 180) - (Math.PI / 2);
      
      const x = cx + r * Math.cos(angleRad);
      const y = cy + r * Math.sin(angleRad);
      
      const isSelected = (plane.hex === state.selectedFlightHex);
      const isTactical = plane.isTactical;
      
      // Look up airline color coding
      const carrierColors = getAircraftColors(plane.flight, isTactical, plane.t);
      const color = carrierColors.main;
      
      // Radar fade effect
      const sweepAngleNorm = (state.radarSweepAngle - (Math.PI / 2) + Math.PI * 4) % (Math.PI * 2);
      const planeAngleNorm = (angleRad + Math.PI * 4) % (Math.PI * 2);
      
      let angleDiff = sweepAngleNorm - planeAngleNorm;
      if (angleDiff < 0) angleDiff += Math.PI * 2;
      
      let sweepGlowOpacity = 0.3;
      if (angleDiff < Math.PI / 4) {
        sweepGlowOpacity = 1.0 - (angleDiff / (Math.PI / 4)) * 0.5;
        if (Math.abs(angleDiff) < 0.05 && (!plane.lastSweepTime || now - plane.lastSweepTime > 2000)) {
          plane.lastSweepTime = now;
          playSound('sweep');
        }
      } else {
        sweepGlowOpacity = 0.5 - (angleDiff / (Math.PI * 2)) * 0.4;
      }
      
      // Determine aircraft icon model class and Flightradar24 proportional scale hierarchy
      const aircraftClass = getAircraftClass(plane.t, isTactical, plane.category, plane.gs, plane.alt_baro);
      
      let baseScale = 17;
      switch (aircraftClass) {
        case 'super_jumbo':    baseScale = 25; break; // A380 / B747 - Superjumbo Heavy (4 engines)
        case 'military_heavy': baseScale = 24; break; // C-5 / B-52 Heavy
        case 'large_airliner': baseScale = 21; break; // B777 / B787 / A350 Widebody (2 engines)
        case 'standard_airliner': baseScale = 17; break; // A320 / B737 Narrowbody
        case 'turboprop':      baseScale = 15; break; // Dash 8 / ATR 72 High Straight Wing
        case 'fighter':        baseScale = 18; break; // F/A-18 / F-35 Tactical Jet
        case 'light':          baseScale = 12; break; // Cessna / Cirrus GA
        default:               baseScale = 17; break;
      }
      const iconSize = isSelected ? Math.round(baseScale * 1.35) : baseScale; 

      // 1. If selected, draw FR24 target selection halo ring around the aircraft
      if (isSelected) {
        radarCtx.save();
        radarCtx.beginPath();
        radarCtx.arc(x, y, iconSize + 12, 0, Math.PI * 2);
        radarCtx.strokeStyle = color;
        radarCtx.lineWidth = 2.0;
        radarCtx.shadowBlur = 10;
        radarCtx.shadowColor = color;
        radarCtx.setLineDash([6, 4]); // Dashed rotating halo ring
        radarCtx.stroke();
        radarCtx.setLineDash([]);
        radarCtx.restore();
      }

      radarCtx.save();
      
      // Flightradar24 Solid Fill with Crisp Dark Border
      radarCtx.fillStyle = color; // Solid vibrant carrier color fill (FR24 signature)
      radarCtx.strokeStyle = '#040812'; // Crisp dark contrast border
      radarCtx.lineWidth = isSelected ? 2.0 : 1.4;
      
      // Translate to position and rotate in heading direction
      radarCtx.translate(x, y);
      const headingRad = ((plane.track || 0) * Math.PI / 180);
      radarCtx.rotate(headingRad);
      
      // Draw model-specific shape path
      switch (aircraftClass) {
        case 'super_jumbo':
          drawSuperJumboIcon(radarCtx, iconSize);
          break;
        case 'fighter':
          drawFighterIcon(radarCtx, iconSize);
          break;
        case 'military_heavy':
          drawSuperJumboIcon(radarCtx, iconSize);
          break;
        case 'large_airliner':
          drawLargeAirlinerIcon(radarCtx, iconSize);
          break;
        case 'standard_airliner':
          drawStandardAirlinerIcon(radarCtx, iconSize);
          break;
        case 'turboprop':
          drawTurbopropIcon(radarCtx, iconSize);
          break;
        case 'light':
          drawLightIcon(radarCtx, iconSize);
          break;
        default:
          drawDefaultIcon(radarCtx, iconSize);
          break;
      }
      
      radarCtx.fill();
      radarCtx.stroke();
      
      radarCtx.restore(); // Restore back to default unrotated canvas context

      // FR24 Projected Heading Vector Line (Dotted line extending ahead showing flight path)
      if (plane.gs && plane.gs > 30) {
        const vecLen = Math.min(40, (plane.gs / 500) * 30 + 12);
        const headingAngle = ((plane.track || 0) * Math.PI / 180) - (Math.PI / 2);
        radarCtx.save();
        radarCtx.beginPath();
        radarCtx.moveTo(x + (iconSize * 1.1) * Math.cos(headingAngle), y + (iconSize * 1.1) * Math.sin(headingAngle));
        radarCtx.lineTo(x + (iconSize * 1.1 + vecLen) * Math.cos(headingAngle), y + (iconSize * 1.1 + vecLen) * Math.sin(headingAngle));
        radarCtx.strokeStyle = color;
        radarCtx.lineWidth = 1.4;
        radarCtx.setLineDash([3, 3]);
        radarCtx.stroke();
        radarCtx.setLineDash([]);
        radarCtx.restore();
      }
      
      // 2. Draw HUD brackets and text labels (unrotated, standing upright)
      if (isSelected) {
        radarCtx.save();
        radarCtx.strokeStyle = color;
        radarCtx.lineWidth = 1.2;
        
        const bSize = 30; 
        
        // Top Left Bracket
        radarCtx.beginPath();
        radarCtx.moveTo(x - bSize, y - bSize + 6);
        radarCtx.lineTo(x - bSize, y - bSize);
        radarCtx.lineTo(x - bSize + 6, y - bSize);
        radarCtx.stroke();
        
        // Top Right Bracket
        radarCtx.beginPath();
        radarCtx.moveTo(x + bSize, y - bSize + 6);
        radarCtx.lineTo(x + bSize, y - bSize);
        radarCtx.lineTo(x + bSize - 6, y - bSize);
        radarCtx.stroke();
        
        // Bottom Left Bracket
        radarCtx.beginPath();
        radarCtx.moveTo(x - bSize, y + bSize - 6);
        radarCtx.lineTo(x - bSize, y + bSize);
        radarCtx.lineTo(x - bSize + 6, y + bSize);
        radarCtx.stroke();
        
        // Bottom Right Bracket
        radarCtx.beginPath();
        radarCtx.moveTo(x + bSize, y + bSize - 6);
        radarCtx.lineTo(x + bSize, y + bSize);
        radarCtx.lineTo(x + bSize - 6, y + bSize);
        radarCtx.stroke();
        
        // Selected index leader vector line
        radarCtx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
        radarCtx.lineWidth = 1;
        radarCtx.beginPath();
        radarCtx.moveTo(x + bSize - 2, y - bSize + 2);
        radarCtx.lineTo(x + bSize + 20, y - bSize - 15);
        radarCtx.lineTo(x + bSize + 65, y - bSize - 15);
        radarCtx.stroke();
        
        // Label text block with transit direction arrow & shortened ICAO model code
        const transit = getTransitStatus(bearing, plane.track);
        const arrow = transit === 'INBOUND' ? '▼' : '▲';
        const modelCode = (plane.t && plane.t !== 'UNKN' && plane.t !== 'N/A') ? plane.t.trim().toUpperCase() : '';
        
        radarCtx.fillStyle = color;
        radarCtx.font = 'bold 28px var(--font-tech)';
        radarCtx.textAlign = 'left';
        radarCtx.textBaseline = 'bottom';
        radarCtx.fillText(`${plane.flight ? plane.flight.trim() : 'UNKN'}${modelCode ? ' (' + modelCode + ')' : ''} ${arrow}`, x + bSize + 24, y - bSize - 16);
        
        radarCtx.font = 'bold 22px var(--font-tech)';
        radarCtx.fillStyle = 'var(--text-primary)';
        radarCtx.fillText(`${Math.round(plane.alt_baro / 100)} FL`, x + bSize + 24, y - bSize + 4);
        radarCtx.fillText(`${Math.round(plane.gs)} KT`, x + bSize + 24, y - bSize + 26);
        radarCtx.restore();
      } else {
        // Labels on all non-selected flights
        if (sweepGlowOpacity > 0.4) {
          radarCtx.save();
          radarCtx.fillStyle = color;
          radarCtx.font = 'bold 24px var(--font-tech)';
          
          const transit = getTransitStatus(bearing, plane.track);
          const arrow = transit === 'INBOUND' ? '▼' : '▲';
          const modelCode = (plane.t && plane.t !== 'UNKN' && plane.t !== 'N/A') ? plane.t.trim().toUpperCase() : '';
          
          radarCtx.globalAlpha = Math.min(sweepGlowOpacity, 0.9);
          radarCtx.fillText(`${plane.flight ? plane.flight.trim() : plane.hex.toUpperCase()}${modelCode ? ' · ' + modelCode : ''} ${arrow}`, x + iconSize + 5, y - iconSize + 5);
          radarCtx.globalAlpha = 1.0;
          radarCtx.restore();
        }
      }
    });
  }

  // --- 4. Simulated/Demo Flight Generator ---
  // If the user has no live telemetry active, generate realistic targets
  const simAirports = [
    { name: 'Sydney Kingsford Smith', lat: -33.9461, lon: 151.1772 },
    { name: 'Melbourne Tullamarine', lat: -37.6690, lon: 144.8410 },
    { name: 'Brisbane Intl', lat: -27.3842, lon: 153.1175 }
  ];

  const simAirlinePool = ['QFA', 'JST', 'VOZ', 'RXA', 'SIA', 'ANZ', 'UAE', 'UAL', 'DAL', 'CPA', 'FJI'];
  const simMilitaryPool = ['RAIDER', 'VIPER', 'HAWK', 'BOGEY', 'RCH', 'CNV', 'ASY'];
  const simAircraftPool = ['B738', 'A21N', 'A20N', 'A320', 'A359', 'B789', 'B38M', 'DH8D', 'E190', 'B77W', 'A388', 'F18', 'F35'];

  function createSimulatedFlight(hex) {
    const isMilitary = Math.random() < 0.2; // 20% chance military target
    const prefix = isMilitary ? 
      simMilitaryPool[Math.floor(Math.random() * simMilitaryPool.length)] : 
      simAirlinePool[Math.floor(Math.random() * simAirlinePool.length)];
    
    const flightNum = String(Math.floor(Math.random() * 899) + 100);
    const flight = `${prefix}${flightNum}`;
    
    // Choose model
    let model = 'B738';
    if (isMilitary) {
      const milModels = ['F18', 'F35', 'F16', 'C17', 'C130'];
      model = milModels[Math.floor(Math.random() * milModels.length)];
    } else {
      const civModels = ['A21N', 'A20N', 'A359', 'B789', 'B38M', 'B738', 'A320', 'DH8D', 'E190', 'B77W', 'A388'];
      model = civModels[Math.floor(Math.random() * civModels.length)];
    }
    
    // Position within radius (e.g. 20 to 90 NM from receiver)
    const distance = Math.random() * 80 + 15;
    const bearing = Math.random() * 360;
    
    // Math to compute lat/lon from distance and bearing
    const R = 3440.065; // Earth radius in NM
    const lat0Rad = state.receiverLat * Math.PI / 180;
    const lon0Rad = state.receiverLon * Math.PI / 180;
    const distRad = distance / R;
    const bearingRad = bearing * Math.PI / 180;
    
    const latRad = Math.asin(
      Math.sin(lat0Rad) * Math.cos(distRad) + 
      Math.cos(lat0Rad) * Math.sin(distRad) * Math.cos(bearingRad)
    );
    const lonRad = lon0Rad + Math.atan2(
      Math.sin(bearingRad) * Math.sin(distRad) * Math.cos(lat0Rad),
      Math.cos(distRad) - Math.sin(lat0Rad) * Math.sin(latRad)
    );
    
    const lat = latRad * 180 / Math.PI;
    const lon = lonRad * 180 / Math.PI;
    
    const alt = isMilitary && ['F16', 'F18', 'F35'].includes(model) ?
      Math.floor(Math.random() * 15000) + 10000 : // lower fighter altitude
      Math.floor(Math.random() * 120) * 100 + 28000; // FL280 to FL400
      
    const speed = isMilitary && ['F16', 'F18', 'F35'].includes(model) ?
      Math.floor(Math.random() * 400) + 400 : // 400 - 800 kts
      Math.floor(Math.random() * 100) + 400; // 400 - 500 kts
      
    const heading = Math.random() * 360;
    
    const flightHex = hex || Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
    
    return {
      hex: flightHex,
      flight: flight,
      t: model,
      alt_baro: alt,
      gs: speed,
      track: heading,
      lat: lat,
      lon: lon,
      seen: 0,
      squawk: String(Math.floor(Math.random() * 7000) + 1000),
      isTactical: isMilitary,
      history: [{ lat, lon }]
    };
  }

  function updateSimulatedFlights() {
    const rangeFilter = state.radarRangeFilter;
    const R = 3440.065;
    
    // Spawn new ones if list is thin
    const currentCount = Object.keys(state.aircraft).length;
    if (currentCount < 6) {
      const hex = Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
      state.aircraft[hex] = createSimulatedFlight(hex);
    }
    
    Object.keys(state.aircraft).forEach(hex => {
      const plane = state.aircraft[hex];
      
      // Calculate new position based on speed and heading
      // Speed is in knots (NM per hour), update frequency is once per second
      const speedNMSec = plane.gs / 3600; 
      const headingRad = plane.track * Math.PI / 180;
      
      const latRad = plane.lat * Math.PI / 180;
      const lonRad = plane.lon * Math.PI / 180;
      const distRad = speedNMSec / R;
      
      const nextLatRad = Math.asin(
        Math.sin(latRad) * Math.cos(distRad) + 
        Math.cos(latRad) * Math.sin(distRad) * Math.cos(headingRad)
      );
      const nextLonRad = lonRad + Math.atan2(
        Math.sin(headingRad) * Math.sin(distRad) * Math.cos(latRad),
        Math.cos(distRad) - Math.sin(latRad) * Math.sin(nextLatRad)
      );
      
      plane.lat = nextLatRad * 180 / Math.PI;
      plane.lon = nextLonRad * 180 / Math.PI;
      
      // Update history trail points
      plane.history.push({ lat: plane.lat, lon: plane.lon });
      if (plane.history.length > parseInt(state.trailLength)) {
        plane.history.shift();
      }
      
      // Occasional gentle turn
      if (Math.random() < 0.05) {
        plane.track = (plane.track + (Math.random() * 20 - 10) + 360) % 360;
      }
      // Occasional altitude drift
      if (Math.random() < 0.05) {
        plane.alt_baro = Math.max(2000, plane.alt_baro + (Math.floor(Math.random() * 5) - 2) * 100);
      }
      
      // If plane moves too far, remove it
      const distance = getDistanceNM(state.receiverLat, state.receiverLon, plane.lat, plane.lon);
      if (distance > rangeFilter * 1.2) {
        delete state.aircraft[hex];
        if (state.selectedFlightHex === hex) {
          state.selectedFlightHex = null;
        }
      }
    });

    updateSidebarLogs();
  }

  // --- 5. Real-Time Telemetry Retrieval (dump1090 Integration) ---
  
  async function fetchLiveTelemetry() {
    if (state.mode !== 'live') return;
    
    const apiEndpoint = `/api/telemetry?url=${encodeURIComponent(state.dump1090Url)}`;
    
    try {
      const response = await fetch(apiEndpoint);
      if (!response.ok) throw new Error('Proxy server error');
      const data = await response.json();
      
      processLiveTelemetry(data.aircraft || []);
      state.isOnline = true;
      document.getElementById('status-glow').className = 'indicator-glow';
      document.getElementById('radar-scan-status').textContent = 'ACTIVE';
    } catch (err) {
      console.warn("Live stream offline, system switching to offline notification:", err.message);
      state.isOnline = false;
      document.getElementById('status-glow').className = 'indicator-glow offline';
      document.getElementById('radar-scan-status').textContent = 'ERROR (SDR OFFLINE)';
    }
  }

  function processLiveTelemetry(liveAircraftList) {
    const activeHexCodes = new Set();
    
    liveAircraftList.forEach(planeData => {
      // Must have basic hex identification and location
      if (!planeData.hex || !planeData.lat || !planeData.lon) return;
      
      const hex = planeData.hex;
      activeHexCodes.add(hex);
      
      const isTactical = isTacticalFlight(planeData.flight, planeData.t, planeData.category);
      
      if (!state.aircraft[hex]) {
        // New plane detected! Play sound if military
        if (isTactical) {
          playSound('lock');
        }
        const modelCode = resolveAircraftModelCode(planeData.t, planeData.category, planeData.gs || planeData.speed, planeData.alt_baro || planeData.altitude, isTactical);
        
        state.aircraft[hex] = {
          hex: hex,
          flight: planeData.flight || 'N/A',
          t: modelCode,
          category: planeData.category || '',
          alt_baro: planeData.alt_baro || planeData.altitude || 0,
          gs: planeData.gs || planeData.speed || 0,
          track: planeData.track || 0,
          lat: planeData.lat,
          lon: planeData.lon,
          squawk: planeData.squawk || '',
          isTactical: isTactical,
          history: [{ lat: planeData.lat, lon: planeData.lon }]
        };
      } else {
        // Update existing record
        const plane = state.aircraft[hex];
        plane.flight = planeData.flight || plane.flight;
        const modelCode = resolveAircraftModelCode(planeData.t || plane.t, planeData.category || plane.category, planeData.gs || plane.gs, planeData.alt_baro || plane.alt_baro, isTactical);
        plane.t = modelCode;
        plane.category = planeData.category || plane.category;
        plane.isTactical = isTacticalFlight(plane.flight, plane.t, planeData.category);
        plane.alt_baro = planeData.alt_baro || planeData.altitude || plane.alt_baro;
 
        plane.gs = planeData.gs || planeData.speed || plane.gs;
        plane.track = planeData.track || plane.track;
        plane.lat = planeData.lat;
        plane.lon = planeData.lon;
        plane.squawk = planeData.squawk || plane.squawk;

        
        // Append history trail
        plane.history.push({ lat: plane.lat, lon: plane.lon });
        if (plane.history.length > parseInt(state.trailLength)) {
          plane.history.shift();
        }
      }
    });
    
    // Clean up planes that aren't in latest feed
    Object.keys(state.aircraft).forEach(hex => {
      if (!activeHexCodes.has(hex)) {
        delete state.aircraft[hex];
        if (state.selectedFlightHex === hex) {
          state.selectedFlightHex = null;
        }
      }
    });

    // Update UI sidebar list once per telemetry update batch
    updateSidebarLogs();
  }

  // --- 6. Live AWACS Voice Commentary System ---
  
  // Lookup Speech voices
  let voices = [];
  function populateVoiceList() {
    if (typeof speechSynthesis === 'undefined') return;
    
    voices = speechSynthesis.getVoices();
    const voiceSelect = document.getElementById('voice-select');
    
    // Clear out but keep default option
    voiceSelect.innerHTML = '<option value="default">System Default</option>';
    
    voices.forEach(voice => {
      // Prioritize English voices for commentary
      if (voice.lang.startsWith('en')) {
        const option = document.createElement('option');
        option.textContent = `${voice.name} (${voice.lang})`;
        option.value = voice.name;
        voiceSelect.appendChild(option);
      }
    });
  }

  populateVoiceList();
  if (typeof speechSynthesis !== 'undefined' && speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = populateVoiceList;
  }

  function getCardinalDirection(track) {
    const directions = ['North', 'North-East', 'East', 'South-East', 'South', 'South-West', 'West', 'North-West'];
    const index = Math.round(((track % 360) / 45)) % 8;
    return directions[index];
  }

  function generateCommentary(plane) {
    const airlineInfo = parseAirline(plane.flight, plane.t);
    const modelInfo = parseModel(plane.t, plane);
    const distance = getDistanceNM(state.receiverLat, state.receiverLon, plane.lat, plane.lon).toFixed(1);
    const bearing = getBearingDegrees(state.receiverLat, state.receiverLon, plane.lat, plane.lon);
    const directionWord = getCardinalDirection(bearing);
    const flightName = plane.flight ? plane.flight.trim() : 'Unknown';
    const altitude = plane.alt_baro;
    const flightLevel = Math.round(altitude / 100);
    const speed = Math.round(plane.gs);
    const course = Math.round(plane.track);
    const transit = getTransitStatus(bearing, course);
    
    if (state.voiceStyle === 'tactical') {
      // AWACS Tactical military announcement
      const designator = plane.isTactical ? 'BOGEY' : 'CONTACT';
      const typeDesc = modelInfo.desc.replace(/^(Airbus|Boeing|Lockheed|McDonnell Douglas|General Dynamics|Sukhoi|Cessna|Bombardier|De Havilland)\s+/i, '');
      const transitWord = transit === 'INBOUND' ? 'INBOUND' : 'OUTBOUND';
      
      return `ALERT. AWACS has designated new ${designator} ${flightName}. Type: ${typeDesc}. Transit: ${transitWord}. Altitude: FLIGHT LEVEL ${flightLevel}. Ground speed: ${speed} knots. Range: ${distance} miles ${directionWord}. System tracking.`;
    } else if (state.voiceStyle === 'cozy') {
      // Cozy observation narration
      const airlineName = airlineInfo.name;
      const targetName = flightName.replace(/([A-Z]+)(\d+)/, '$1 $2'); // Separate letters and numbers for pronunciation
      const transitWord = transit === 'INBOUND' ? 'heading towards us' : 'moving away';
      
      let sentence = `Overhead is ${airlineName} Flight ${targetName}, ${transitWord}. `;
      if (plane.t) {
        sentence += `It is a ${modelInfo.desc}, `;
      }
      sentence += `flying at ${altitude.toLocaleString()} feet, traveling at ${speed} knots heading ${getCardinalDirection(course)}. It is currently ${distance} nautical miles to our ${directionWord}.`;
      return sentence;
    }
    
    return '';
  }

  function speakCommentary(text) {
    if (state.voiceStyle === 'disabled' || state.muted || !text) return;
    
    // Stop any running speech
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.volume = state.voiceVolume;
      
      // Select voice from settings
      if (state.selectedVoiceName !== 'default') {
        const voice = voices.find(v => v.name === state.selectedVoiceName);
        if (voice) utterance.voice = voice;
      }
      
      // Style adjustments
      if (state.voiceStyle === 'tactical') {
        // Military robot voice parameters
        utterance.rate = 1.05;
        utterance.pitch = 0.9;
      } else {
        // Soft calming voice parameters
        utterance.rate = 0.92;
        utterance.pitch = 1.0;
      }
      
      window.speechSynthesis.speak(utterance);
    }
  }

  function triggerVoiceRoutine() {
    const now = Date.now();
    const intervalMs = state.voiceInterval * 1000;
    
    if (now - state.lastVoiceTime < intervalMs) return;
    
    // Find planes to announce
    const planes = Object.values(state.aircraft);
    if (planes.length === 0) return;
    
    // Prioritize selected flight, else tactical military flights, else closest flight
    let targetPlane = null;
    
    if (state.selectedFlightHex && state.aircraft[state.selectedFlightHex]) {
      targetPlane = state.aircraft[state.selectedFlightHex];
    } else {
      // Look for military targets
      const milPlanes = planes.filter(p => p.isTactical);
      if (milPlanes.length > 0) {
        // Pick the closest military target
        milPlanes.sort((a, b) => {
          const distA = getDistanceNM(state.receiverLat, state.receiverLon, a.lat, a.lon);
          const distB = getDistanceNM(state.receiverLat, state.receiverLon, b.lat, b.lon);
          return distA - distB;
        });
        targetPlane = milPlanes[0];
      } else {
        // Pick the closest general flight
        planes.sort((a, b) => {
          const distA = getDistanceNM(state.receiverLat, state.receiverLon, a.lat, a.lon);
          const distB = getDistanceNM(state.receiverLat, state.receiverLon, b.lat, b.lon);
          return distA - distB;
        });
        targetPlane = planes[0];
      }
    }
    
    if (targetPlane) {
      const speechText = generateCommentary(targetPlane);
      speakCommentary(speechText);
      state.lastVoiceTime = now;
    }
  }

  // --- 7. UI Sidebar Log and Info Panels Update ---
  
  function updateSidebarLogs() {
    const list = document.getElementById('flight-list');
    const planes = Object.values(state.aircraft);
    
    if (planes.length === 0) {
      list.innerHTML = '<li class="empty-list-msg">NO TARGETS IN RANGE</li>';
      document.getElementById('contacts-count').textContent = '0';
      return;
    }
    
    // Sort flights: military first, then by proximity (distance)
    planes.sort((a, b) => {
      if (a.isTactical && !b.isTactical) return -1;
      if (!a.isTactical && b.isTactical) return 1;
      
      const distA = getDistanceNM(state.receiverLat, state.receiverLon, a.lat, a.lon);
      const distB = getDistanceNM(state.receiverLat, state.receiverLon, b.lat, b.lon);
      return distA - distB;
    });
    
    document.getElementById('contacts-count').textContent = planes.length;
    
    let html = '';
    planes.forEach(plane => {
      const distance = getDistanceNM(state.receiverLat, state.receiverLon, plane.lat, plane.lon).toFixed(1);
      const isSelected = plane.hex === state.selectedFlightHex;
      const isTactical = plane.isTactical;
      const airlineInfo = parseAirline(plane.flight, plane.t);
      
      const itemClass = `flight-item ${isTactical ? 'tactical' : ''} ${isSelected ? 'selected' : ''}`;
      
      html += `
        <li class="${itemClass}" data-hex="${plane.hex}">
          <div class="flight-meta">
            <span class="flight-callsign">${plane.flight ? plane.flight.trim() : 'UNKN'}</span>
            <span class="flight-desc">${isTactical ? 'MILITARY AIRCRAFT' : airlineInfo.name}</span>
          </div>
          <div class="flight-telemetry-brief">
            <span class="flight-alt">FL${Math.round(plane.alt_baro / 100)}</span>
            <span class="flight-range">${distance} NM</span>
          </div>
        </li>
      `;
    });
    
    list.innerHTML = html;
    
    // Setup click handlers
    const items = list.querySelectorAll('.flight-item');
    items.forEach(item => {
      item.addEventListener('click', () => {
        const hex = item.getAttribute('data-hex');
        selectFlight(hex);
      });
    });
  }

  function selectFlight(hex) {
    if (state.selectedFlightHex === hex) return;
    
    state.selectedFlightHex = hex;
    updateSidebarLogs();
    
    const detailPanel = document.getElementById('target-detail-panel');
    const warningPanel = document.getElementById('tactical-lock-warning');
    const outerRing = document.getElementById('hud-overlay');
    
    if (hex && state.aircraft[hex]) {
      const plane = state.aircraft[hex];
      const distance = getDistanceNM(state.receiverLat, state.receiverLon, plane.lat, plane.lon).toFixed(1);
      const bearing = getBearingDegrees(state.receiverLat, state.receiverLon, plane.lat, plane.lon).toFixed(0);
      const airlineInfo = parseAirline(plane.flight, plane.t);
      const modelInfo = parseModel(plane.t, plane);
      
      // Play target acquire sound
      playSound('lock');
      
      // Update sidebar telemetry panel
      document.getElementById('target-callsign').textContent = plane.flight ? plane.flight.trim() : plane.hex.toUpperCase();
      document.getElementById('target-airline').textContent = airlineInfo.name;
      document.getElementById('target-model').textContent = modelInfo.desc;
      document.getElementById('target-altitude').textContent = `${plane.alt_baro.toLocaleString()} ft (FL${Math.round(plane.alt_baro / 100)})`;
      document.getElementById('target-speed').textContent = `${Math.round(plane.gs)} kts (${Math.round(plane.gs * 1.15)} mph)`;
      document.getElementById('target-heading').textContent = `${Math.round(plane.track)}° ${getCardinalDirection(plane.track)}`;
      document.getElementById('target-range').textContent = `${distance} NM (Brg ${bearing}°)`;
      
      const transit = getTransitStatus(parseFloat(bearing), plane.track);
      const transitEl = document.getElementById('target-transit');
      transitEl.textContent = transit === 'INBOUND' ? 'INBOUND ▼' : 'OUTBOUND ▲';
      transitEl.className = transit === 'INBOUND' ? 'value inbound' : 'value outbound';
      
      document.getElementById('target-squawk').textContent = plane.squawk || '0000';
      
      const badge = document.getElementById('target-category');

      badge.textContent = plane.isTactical ? 'TACTICAL TARGET' : 'COMMERCIAL';
      badge.className = `target-badge ${plane.isTactical ? 'tactical' : ''}`;
      
      detailPanel.classList.remove('hidden');
      
      // Alarm display if military flight
      if (plane.isTactical) {
        document.getElementById('lock-details').textContent = `TACTICAL LOCK ON ${plane.flight.trim()} - TYPE: ${plane.t}`;
        warningPanel.classList.remove('hidden');
        outerRing.classList.add('target-locked-alert-mode');
        
        // Auto verbal update immediately
        const speechText = generateCommentary(plane);
        speakCommentary(speechText);
        state.lastVoiceTime = Date.now();
      } else {
        warningPanel.classList.add('hidden');
        outerRing.classList.remove('target-locked-alert-mode');
      }
    } else {
      detailPanel.classList.add('hidden');
      warningPanel.classList.add('hidden');
      outerRing.classList.remove('target-locked-alert-mode');
    }
  }

  // --- 8. Cockpit HUD Updates ---
  function updateHUDAvionics() {
    const headingTape = document.getElementById('heading-tape');
    const pitchLadder = document.querySelector('.pitch-ladder');
    
    let currentHeading = 0;
    
    // Sync HUD display with selected aircraft telemetry if available
    if (state.selectedFlightHex && state.aircraft[state.selectedFlightHex]) {
      const plane = state.aircraft[state.selectedFlightHex];
      currentHeading = plane.track || 0;
      
      // Cockpit sway based on flight trajectory
      const roll = Math.sin(Date.now() * 0.001) * 3;
      const pitch = Math.cos(Date.now() * 0.0005) * 5;
      pitchLadder.style.transform = `translate(-50%, -50%) rotate(${roll}deg) translateY(${pitch}px)`;
      pitchLadder.style.opacity = '0.4';
    } else {
      // Idle slow sway
      const roll = Math.sin(Date.now() * 0.0003) * 1.5;
      const pitch = Math.cos(Date.now() * 0.0002) * 3;
      pitchLadder.style.transform = `translate(-50%, -50%) rotate(${roll}deg) translateY(${pitch}px)`;
      pitchLadder.style.opacity = '0.15';
    }
    
    // Align heading tape (one degree = 2 pixels offset roughly)
    // Tape coordinates: N (0), E (90), S (180), W (270)
    // Left offset calculation
    const tapeOffset = -((currentHeading % 360) * 2) - 100;
    headingTape.style.left = `${tapeOffset}px`;
  }

  // --- 9. Setup Event Listeners & Configuration Controls ---
  
  function applyProjectionTransforms() {
    const container = document.getElementById('projection-container');
    
    let transformStr = '';
    
    // Scale flips
    const scaleX = state.mirrorH ? -1 : 1;
    const scaleY = state.mirrorV ? -1 : 1;
    transformStr += `scaleX(${scaleX}) scaleY(${scaleY}) `;
    
    // Rotation
    transformStr += `rotate(${state.projectionRotation}deg)`;
    
    container.style.transform = transformStr;
  }

  function setupControls() {
    // Menu buttons
    const menuToggle = document.getElementById('menu-toggle-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettings = document.getElementById('close-settings-btn');
    const saveSettings = document.getElementById('save-settings-btn');
    
    menuToggle.addEventListener('click', () => {
      settingsModal.classList.remove('hidden');
    });
    
    closeSettings.addEventListener('click', () => {
      settingsModal.classList.add('hidden');
    });
    
    // Sidebar toggle
    const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
    const sidebar = document.getElementById('sidebar');
    toggleSidebarBtn.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
    });
    
    // Mode toggle shortcut button in footer
    const modeBtn = document.getElementById('simulation-toggle-btn');
    modeBtn.addEventListener('click', () => {
      if (state.mode === 'simulated') {
        state.mode = 'live';
        modeBtn.textContent = 'MODE: LIVE SDR';
        modeBtn.classList.add('glow-active');
        document.getElementById('live-settings-group').classList.remove('hidden');
        document.getElementById('status-glow').className = 'indicator-glow';
        // Clear simulated flights
        state.aircraft = {};
        state.selectedFlightHex = null;
        selectFlight(null);
      } else {
        state.mode = 'simulated';
        modeBtn.textContent = 'MODE: SIMULATOR';
        modeBtn.classList.remove('glow-active');
        document.getElementById('live-settings-group').classList.add('hidden');
        document.getElementById('status-glow').className = 'indicator-glow simulated';
        state.aircraft = {};
        state.selectedFlightHex = null;
        selectFlight(null);
      }
    });

    // Mute button
    const muteBtn = document.getElementById('mute-btn');
    muteBtn.addEventListener('click', () => {
      state.muted = !state.muted;
      muteBtn.textContent = state.muted ? '🔇' : '🔊';
      muteBtn.classList.toggle('glow-active', !state.muted);
      
      if (state.muted && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    });
    
    // Manual Speech commentary trigger button
    document.getElementById('voice-test-btn').addEventListener('click', () => {
      if (state.selectedFlightHex && state.aircraft[state.selectedFlightHex]) {
        const text = generateCommentary(state.aircraft[state.selectedFlightHex]);
        speakCommentary(text);
      } else {
        const planes = Object.values(state.aircraft);
        if (planes.length > 0) {
          const text = generateCommentary(planes[0]);
          speakCommentary(text);
        } else {
          speakCommentary("System telemetry reporting: No aircraft currently in radar detection range.");
        }
      }
    });

    // Handle form change display toggles
    document.getElementById('connection-mode').addEventListener('change', (e) => {
      const mode = e.target.value;
      const group = document.getElementById('live-settings-group');
      if (mode === 'live') {
        group.classList.remove('hidden');
      } else {
        group.classList.add('hidden');
      }
    });

    // Target lock button in detail panel
    document.getElementById('lock-target-btn').addEventListener('click', () => {
      if (state.selectedFlightHex && state.aircraft[state.selectedFlightHex]) {
        playSound('lock');
        const plane = state.aircraft[state.selectedFlightHex];
        const speechText = generateCommentary(plane);
        speakCommentary(speechText);
      }
    });

    // Apply Settings action
    saveSettings.addEventListener('click', () => {
      // Connection
      const modeSel = document.getElementById('connection-mode').value;
      const prevMode = state.mode;
      state.mode = modeSel;
      
      state.dump1090Url = document.getElementById('dump1090-url').value;
      state.receiverLat = parseFloat(document.getElementById('receiver-lat').value);
      state.receiverLon = parseFloat(document.getElementById('receiver-lon').value);
      
      // Update footer mode shortcut button style
      if (state.mode === 'live') {
        modeBtn.textContent = 'MODE: LIVE SDR';
        modeBtn.classList.add('glow-active');
        document.getElementById('status-glow').className = 'indicator-glow';
      } else {
        modeBtn.textContent = 'MODE: SIMULATOR';
        modeBtn.classList.remove('glow-active');
        document.getElementById('status-glow').className = 'indicator-glow simulated';
      }

      // If mode switched, wipe cache to reload correctly
      if (prevMode !== state.mode) {
        state.aircraft = {};
        state.selectedFlightHex = null;
        selectFlight(null);
      }
      
      // Voice
      state.voiceStyle = document.getElementById('voice-style').value;
      state.voiceInterval = parseInt(document.getElementById('voice-interval').value);
      state.selectedVoiceName = document.getElementById('voice-select').value;
      
      // Optics
      state.projectionRotation = parseInt(document.getElementById('projection-rotation').value);
      state.mirrorH = document.getElementById('mirror-h').checked;
      state.mirrorV = document.getElementById('mirror-v').checked;
      
      applyProjectionTransforms();
      
      // Starfield config
      const prevStarCount = state.starCount;
      state.starCount = parseInt(document.getElementById('star-count').value);
      state.starSpeed = parseInt(document.getElementById('star-speed').value);
      
      if (prevStarCount !== state.starCount) {
        generateStars();
      }
      
      // Radar range & trails
      state.radarRangeFilter = parseInt(document.getElementById('radar-range-filter').value);
      state.trailLength = parseInt(document.getElementById('trail-length').value);
      
      settingsModal.classList.add('hidden');
    });

    // Canvas click detection to select flights
    radarCanvas.addEventListener('click', (e) => {
      const rect = radarCanvas.getBoundingClientRect();
      // Mouse coordinates inside radar circle
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      
      const cx = radarViewportSize / 2;
      const cy = radarViewportSize / 2;
      const maxRadius = (radarViewportSize / 2) * 0.95;
      const rangeFilter = state.radarRangeFilter;
      
      // Look for clicked aircraft
      let clickedHex = null;
      let minDistance = 25; // Selection tolerance in pixels
      
      Object.values(state.aircraft).forEach(plane => {
        if (!plane.lat || !plane.lon) return;
        
        const distance = getDistanceNM(state.receiverLat, state.receiverLon, plane.lat, plane.lon);
        if (distance > rangeFilter) return;
        
        const bearing = getBearingDegrees(state.receiverLat, state.receiverLon, plane.lat, plane.lon);
        const r = (distance / rangeFilter) * maxRadius;
        const angleRad = (bearing * Math.PI / 180) - (Math.PI / 2);
        
        const px = cx + r * Math.cos(angleRad);
        const py = cy + r * Math.sin(angleRad);
        
        const distSq = (mx - px) * (mx - px) + (my - py) * (my - py);
        const distPx = Math.sqrt(distSq);
        
        if (distPx < minDistance) {
          minDistance = distPx;
          clickedHex = plane.hex;
        }
      });
      
      if (clickedHex) {
        selectFlight(clickedHex);
      }
    });
  }

  // Show a brief HUD notification banner
  function showLocationBanner(text) {
    const existing = document.getElementById('location-banner');
    if (existing) existing.remove();
    
    const banner = document.createElement('div');
    banner.id = 'location-banner';
    banner.style.cssText = `
      position: fixed;
      bottom: 60px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 240, 255, 0.12);
      border: 1px solid rgba(0, 240, 255, 0.5);
      color: var(--hud-cyan);
      font-family: var(--font-tech);
      font-size: 11px;
      letter-spacing: 0.1em;
      padding: 7px 18px;
      border-radius: 4px;
      z-index: 9999;
      pointer-events: none;
      transition: opacity 0.8s ease;
    `;
    banner.textContent = text;
    document.body.appendChild(banner);
    setTimeout(() => { banner.style.opacity = '0'; }, 3500);
    setTimeout(() => { banner.remove(); }, 4300);
  }

  // Auto-detect browser coordinates on startup to configure receiver
  // Works in BOTH simulated and live modes - always center on your home!
  function autoDetectReceiverLocation() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          // Only apply if user hasn't already manually configured
          if (!state.receiverAutoDetected) {
            state.receiverLat = position.coords.latitude;
            state.receiverLon = position.coords.longitude;
            state.receiverAutoDetected = true;
            
            // Sync values to form input fields
            document.getElementById('receiver-lat').value = state.receiverLat.toFixed(5);
            document.getElementById('receiver-lon').value = state.receiverLon.toFixed(5);
            
            showLocationBanner(`📍 RADAR ORIGIN LOCKED — YOUR LOCATION: ${state.receiverLat.toFixed(4)}, ${state.receiverLon.toFixed(4)}`);
            console.log(`Geolocation auto-set: ${state.receiverLat}, ${state.receiverLon}`);
          }
        },
        (error) => {
          console.log('Browser geolocation declined/unavailable, using default Sydney coords.');
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
      );
    }
  }

  // Fetch receiver GPS from dump1090 receiver.json (works in any mode)
  // dump1090 knows the antenna location, so this is the most accurate source
  async function fetchReceiverSettings() {
    try {
      const response = await fetch(`/api/receiver?url=${encodeURIComponent(state.dump1090Url)}`);
      if (response.ok) {
        const data = await response.json();
        // If dump1090 has GPS configured (lat/lon in receiver.json), always prefer it
        if (data.lat && data.lon) {
          const lat = parseFloat(data.lat);
          const lon = parseFloat(data.lon);
          // Only update if it's meaningfully different (not the dump1090 0,0 default)
          if (Math.abs(lat) > 0.01 || Math.abs(lon) > 0.01) {
            state.receiverLat = lat;
            state.receiverLon = lon;
            state.receiverAutoDetected = true;
            document.getElementById('receiver-lat').value = state.receiverLat.toFixed(5);
            document.getElementById('receiver-lon').value = state.receiverLon.toFixed(5);
            showLocationBanner(`📡 ANTENNA GPS LOCKED — DUMP1090 ORIGIN: ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
            console.log(`dump1090 receiver.json GPS applied: ${lat}, ${lon}`);
          }
        }
      }
    } catch (e) {
      // Silent fail — dump1090 may not be running yet (simulated mode)
      console.log('Could not fetch receiver.json (dump1090 may be offline):', e.message);
    }
  }

  // --- 10. Main System Game Loop & Initialization ---
  
  function updateTimeClock() {
    const clock = document.getElementById('utc-clock');
    const now = new Date();
    clock.textContent = now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  }

  function tick() {
    try {
      // 1. Draw Starfield Background
      drawStarfield();
      
      // 2. Render radar objects
      drawRadar();
      
      // 3. Update HUD heading tape & pitch ladder
      updateHUDAvionics();
      
      // 4. Trigger voice commentary checks
      triggerVoiceRoutine();
    } catch (err) {
      console.error("Frame render error:", err);
    }
    
    // Loop
    requestAnimationFrame(tick);
  }

  function init() {
    // Resize listeners
    window.addEventListener('resize', () => {
      resizeStarfield();
      resizeRadar();
    });
    
    // Setup controls
    setupControls();
    
    // Auto detect coordinates
    autoDetectReceiverLocation();
    
    // Initial size trigger
    resizeStarfield();
    resizeRadar();
    
    // Start UTC Clock timer
    setInterval(updateTimeClock, 1000);
    
    // Telemetry & Simulation updates timer (every 1 second)
    setInterval(() => {
      if (state.mode === 'live') {
        fetchLiveTelemetry();
      } else if (state.mode === 'simulated') {
        updateSimulatedFlights();
      }
    }, 1000);

    // Initial query
    fetchReceiverSettings();
    
    // Start drawing loops
    requestAnimationFrame(tick);
  }

  // Trigger boot
  window.addEventListener('load', init);

})();
