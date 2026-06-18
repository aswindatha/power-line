import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import ShaderBackground from './ShaderBackground';

// Helper to determine the backend API base URL
const getBackendUrl = () => {
  const savedUrl = localStorage.getItem('backend_url');
  if (savedUrl) return savedUrl;
  
  // In development, default to laptop server on port 5000
  if (window.location.port === '5173') {
    return 'http://localhost:5000';
  }
  return window.location.origin;
};

// Alert/Warning threshold matching backend config (70% of baseline)
const ALERT_THRESHOLD = 0.70;

// Web Audio API Dual-Tone Alarm sound synthesizer
let alarmInterval = null;
const startAlarm = (soundEnabled = true) => {
  if (alarmInterval || !soundEnabled) return;
  
  const playBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      
      // We will create two oscillators for a dual-tone discordant industrial alarm sound
      const osc1 = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc1.type = 'sawtooth';
      osc2.type = 'sawtooth';
      
      // Sweeping frequency modulation
      osc1.frequency.setValueAtTime(600, audioCtx.currentTime);
      osc1.frequency.linearRampToValueAtTime(1000, audioCtx.currentTime + 0.4);
      osc1.frequency.linearRampToValueAtTime(600, audioCtx.currentTime + 0.8);
      
      osc2.frequency.setValueAtTime(605, audioCtx.currentTime);
      osc2.frequency.linearRampToValueAtTime(1005, audioCtx.currentTime + 0.4);
      osc2.frequency.linearRampToValueAtTime(605, audioCtx.currentTime + 0.8);
      
      gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.8);
      
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc1.start();
      osc2.start();
      osc1.stop(audioCtx.currentTime + 0.8);
      osc2.stop(audioCtx.currentTime + 0.8);
    } catch (e) {
      console.warn("AudioContext blocked or failed to load:", e);
    }
  };

  playBeep();
  alarmInterval = setInterval(playBeep, 1000);
};

const stopAlarm = () => {
  if (alarmInterval) {
    clearInterval(alarmInterval);
    alarmInterval = null;
  }
};

// SVG Sparkline Component for real-time tension charting
const Sparkline = ({ data, baseline }) => {
  if (!data || data.length === 0) {
    return (
      <div className="w-full h-16 flex items-center justify-center text-on-surface-variant/40 font-mono-data text-xs">
        No active telemetry data
      </div>
    );
  }
  const width = 300;
  const height = 60;
  const padding = 5;
  const minVal = Math.min(...data, baseline * 0.5) - padding;
  const maxVal = Math.max(...data, baseline * 1.2) + padding;
  const range = maxVal - minVal || 1;
  
  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * (width - 2 * padding) + padding;
    const y = height - ((val - minVal) / range) * (height - 2 * padding) - padding;
    return `${x},${y}`;
  });
  
  const pathData = `M ${points.join(' L ')}`;
  const fillPathData = `${pathData} L ${width - padding},${height} L ${padding},${height} Z`;

  return (
    <svg className="w-full h-full overflow-visible" viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id="sparkline-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#00f1fe" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#00f1fe" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Baseline guide line */}
      {baseline && (
        <line 
          x1={padding} 
          y1={height - ((baseline - minVal) / range) * (height - 2 * padding) - padding}
          x2={width - padding}
          y2={height - ((baseline - minVal) / range) * (height - 2 * padding) - padding}
          stroke="rgba(173,198,255,0.25)"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
      )}
      {/* Area fill */}
      <path d={fillPathData} fill="url(#sparkline-grad)" />
      {/* Line path */}
      <path d={pathData} fill="none" stroke="#00f1fe" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

// Main App Component
function App() {
  const [currentView, setCurrentView] = useState('splash'); // 'splash', 'dashboard', 'settings', 'scanner'
  const [backendUrl, setBackendUrl] = useState(getBackendUrl());
  
  // Connection and API States
  const [connectionStatus, setConnectionStatus] = useState('Disconnected'); // 'Connected', 'Disconnected', 'Connecting'
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [tension, setTension] = useState(847.0);
  const [baselineVal, setBaselineVal] = useState(850.0);
  const [statusVal, setStatusVal] = useState('SAFE');
  const [stationName, setStationName] = useState('Station Alpha');
  const [transmissionLine, setTransmissionLine] = useState('Line 12');
  const [mapsUrl, setMapsUrl] = useState('https://maps.app.goo.gl/cG3Vp3PG5SM1JvLQ9');
  const [history, setHistory] = useState([]);
  
  // Settings Screen values (local inputs before saving)
  const [tempStationName, setTempStationName] = useState('');
  const [tempLineName, setTempLineName] = useState('');
  const [tempMapsUrl, setTempMapsUrl] = useState('');
  const [manualBackendUrl, setManualBackendUrl] = useState('');
  
  // Toggles
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [vibrationEnabled, setVibrationEnabled] = useState(true);
  const [autoOpenAlert, setAutoOpenAlert] = useState(true);
  
  // Alert dismissal/acknowledgment handling
  const [acknowledgedAlertTime, setAcknowledgedAlertTime] = useState(null);
  const [lastCutTime, setLastCutTime] = useState(null);
  
  // Splash loader state
  const [splashProgress, setSplashProgress] = useState(0);
  const [splashStatus, setSplashStatus] = useState('Initializing Telemetry...');
  
  // Handle QR scanner setup
  const qrScannerRef = useRef(null);
  const [cameraError, setCameraError] = useState(null);

  // Splash Screen progress simulation
  useEffect(() => {
    if (currentView !== 'splash') return;
    
    const statuses = [
      "Establishing Secure Link...",
      "Syncing Grid Nodes...",
      "Calibrating Sensors...",
      "Fetching Live Stream...",
      "Telemetry Link Active"
    ];
    
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.random() * 18;
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        setSplashProgress(100);
        setTimeout(() => {
          setCurrentView('dashboard');
        }, 600);
      } else {
        setSplashProgress(Math.floor(progress));
        const statusIdx = Math.min(
          Math.floor((progress / 100) * statuses.length),
          statuses.length - 1
        );
        setSplashStatus(statuses[statusIdx]);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [currentView]);

  // Main polling interval to fetch data from Python Flask backend
  useEffect(() => {
    if (currentView === 'splash') return;

    let isMounted = true;
    
    const fetchStatus = () => {
      setConnectionStatus(prev => prev === 'Disconnected' ? 'Connecting' : prev);
      
      fetch(`${backendUrl}/api/status`)
        .then(res => res.json())
        .then(data => {
          if (!isMounted) return;
          setConnectionStatus('Connected');
          setIsMonitoring(data.monitoring);
          setTension(data.tension);
          setBaselineVal(data.baseline);
          setStatusVal(data.status);
          setStationName(data.station_name);
          setTransmissionLine(data.transmission_line);
          setMapsUrl(data.maps_url);
          setHistory(data.history || []);
          
          if (data.status === 'ALERT' && !lastCutTime) {
            setLastCutTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
          } else if (data.status !== 'ALERT') {
            setLastCutTime(null);
            setAcknowledgedAlertTime(null);
          }
        })
        .catch(err => {
          if (!isMounted) return;
          console.error("Fetch telemetry failed:", err);
          setConnectionStatus('Disconnected');
        });
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 1000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [backendUrl, currentView, lastCutTime]);

  // Alarm sound & vibration handler
  useEffect(() => {
    // Show alert overlay if:
    // status is ALERT, sound/vibration are active, and not already acknowledged
    const shouldAlarmActive = statusVal === 'ALERT' && acknowledgedAlertTime === null;
    
    if (shouldAlarmActive) {
      startAlarm(soundEnabled);
      if (vibrationEnabled && navigator.vibrate) {
        navigator.vibrate([300, 100, 300, 100, 300]);
      }
    } else {
      stopAlarm();
    }

    return () => stopAlarm();
  }, [statusVal, acknowledgedAlertTime, soundEnabled, vibrationEnabled]);

  // Setup QR Scanner scanner in active view
  useEffect(() => {
    if (currentView !== 'scanner') {
      if (qrScannerRef.current) {
        const scanner = qrScannerRef.current;
        qrScannerRef.current = null;
        if (scanner.isScanning) {
          scanner.stop().catch(err => console.warn("Failed to stop scanner:", err));
        }
      }
      return;
    }

    // Reset error when entering scanner view
    setCameraError(null);

    const startScanner = async () => {
      // Check if secure context
      const isSecure = window.isSecureContext;
      const hasMediaDevices = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
      
      if (!hasMediaDevices) {
        if (!isSecure) {
          setCameraError("Camera access requires a Secure Context (HTTPS or localhost).\n\nSince you are connecting to a local IP over HTTP, standard browser security blocks the camera.\n\nTo scan, please run the native PowerGuard Mobile App, or configure chrome://flags to trust this origin.");
        } else {
          setCameraError("Camera hardware/APIs are not available on this device.");
        }
        return;
      }

      try {
        const scanner = new Html5Qrcode("qr-reader-element");
        qrScannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0
          },
          (decodedText) => {
            // Save url
            localStorage.setItem('backend_url', decodedText);
            setBackendUrl(decodedText);
            setConnectionStatus('Connecting');
            
            if (qrScannerRef.current === scanner) {
              qrScannerRef.current = null;
              scanner.stop().then(() => {
                setCurrentView('settings');
              }).catch(() => {
                setCurrentView('settings');
              });
            }
          },
          (error) => {
            // scan error, normal behavior when scanning blank spaces
          }
        );
      } catch (err) {
        console.error("Failed to start QR scanner:", err);
        let errMsg = "Could not access camera. Please check app permissions.";
        if (err.name === "NotAllowedError" || err.message?.includes("Permission denied")) {
          errMsg = "Camera permission denied.\n\nPlease ensure camera permissions are enabled in your device settings.";
        } else if (err.name === "NotFoundError" || err.message?.includes("Requested device not found")) {
          errMsg = "No camera hardware detected on this device.";
        } else if (err.message) {
          errMsg = `Camera Error: ${err.message}`;
        }
        setCameraError(errMsg);
      }
    };

    // Delay start slightly to let DOM compile
    const timer = setTimeout(startScanner, 200);
    return () => {
      clearTimeout(timer);
      if (qrScannerRef.current) {
        const scanner = qrScannerRef.current;
        qrScannerRef.current = null;
        if (scanner.isScanning) {
          scanner.stop().catch(err => console.warn("Failed to stop scanner on unmount:", err));
        }
      }
    };
  }, [currentView]);

  // Load configuration details for settings screen
  const enterSettings = () => {
    setTempStationName(stationName);
    setTempLineName(transmissionLine);
    setTempMapsUrl(mapsUrl);
    setManualBackendUrl(backendUrl);
    setCurrentView('settings');
  };

  // POST request to update settings on the server
  const handleSaveSettings = () => {
    // If the backend URL was manually changed
    if (manualBackendUrl !== backendUrl) {
      localStorage.setItem('backend_url', manualBackendUrl);
      setBackendUrl(manualBackendUrl);
    }

    fetch(`${backendUrl}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        station_name: tempStationName,
        transmission_line: tempLineName,
        maps_url: tempMapsUrl
      })
    })
    .then(res => res.json())
    .then(data => {
      setStationName(data.station_name);
      setTransmissionLine(data.transmission_line);
      setMapsUrl(data.maps_url);
      setCurrentView('dashboard');
    })
    .catch(err => {
      alert("Failed to save backend settings: " + err.message);
    });
  };

  // Commands to start/stop monitoring on the Python server
  const startMonitoring = () => {
    fetch(`${backendUrl}/api/start`, { method: 'POST' })
      .then(res => res.json())
      .then(() => {
        setIsMonitoring(true);
        setStatusVal('SAFE');
        setAcknowledgedAlertTime(null);
      })
      .catch(err => console.error(err));
  };

  const stopMonitoring = () => {
    fetch(`${backendUrl}/api/stop`, { method: 'POST' })
      .then(res => res.json())
      .then(() => {
        setIsMonitoring(false);
        setStatusVal('SAFE');
        setAcknowledgedAlertTime(null);
      })
      .catch(err => console.error(err));
  };

  const handleAcknowledgeAlert = () => {
    setAcknowledgedAlertTime(new Date());
    stopAlarm();
  };

  // Determine dynamic visual integrity styles
  let statusGlowClass = 'status-glow-green';
  let statusTextClass = 'text-green-400';
  let statusIcon = 'shield';
  let statusBg = 'bg-green-500/10';

  if (statusVal === 'WARNING') {
    statusGlowClass = 'status-glow-orange';
    statusTextClass = 'text-orange-400';
    statusIcon = 'warning';
    statusBg = 'bg-orange-500/10';
  } else if (statusVal === 'ALERT') {
    statusGlowClass = 'status-glow-red';
    statusTextClass = 'text-red-500';
    statusIcon = 'emergency_home';
    statusBg = 'bg-red-500/10';
  }

  // Render App Content
  return (
    <div className="relative min-h-screen w-full flex flex-col items-center justify-between overflow-x-hidden selection:bg-primary-container">
      
      {/* 1. SPLASH SCREEN VIEW */}
      {currentView === 'splash' && (
        <div className="fixed inset-0 z-50 bg-[#0e0e0e] flex flex-col items-center justify-center">
          <ShaderBackground />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#0e0e0e]/20 to-[#0e0e0e] opacity-85 pointer-events-none"></div>
          
          <main className="relative z-10 flex flex-col items-center justify-center w-full max-w-md px-container-padding text-center h-full">
            {/* Pulsing Rotating Transmission Tower SVG Logo */}
            <div className="relative mb-stack-gap reveal-content" style={{ animationDelay: '0.2s' }}>
              <div className="absolute inset-0 blur-3xl bg-secondary-container/10 rounded-full scale-150 animate-pulse"></div>
              <div className="w-48 h-48 relative z-20 flex items-center justify-center">
                <svg fill="none" height="180" viewBox="0 0 200 200" width="180" xmlns="http://www.w3.org/2000/svg" className="animate-spin-slow">
                  <path d="M100 40L140 160H60L100 40Z" stroke="#00F2FF" strokeLinejoin="round" strokeWidth="4"></path>
                  <path d="M80 80H120" stroke="#00F2FF" strokeWidth="4"></path>
                  <path d="M70 120H130" stroke="#00F2FF" strokeWidth="4"></path>
                  <path d="M100 40V160" stroke="#00F2FF" strokeWidth="2"></path>
                  
                  {/* Wave Pulses */}
                  <path d="M40 80C60 70 80 90 100 80" stroke="#007AFF" strokeLinecap="round" strokeWidth="3">
                    <animate attributeName="d" dur="2s" repeatCount="indefinite" values="M40 80C60 70 80 90 100 80;M40 80C60 90 80 70 100 80;M40 80C60 70 80 90 100 80"></animate>
                    <animate attributeName="stroke-opacity" dur="2s" repeatCount="indefinite" values="0.3;1;0.3"></animate>
                  </path>
                  <path d="M100 80C120 70 140 90 160 80" stroke="#007AFF" strokeLinecap="round" strokeWidth="3">
                    <animate attributeName="d" dur="2s" repeatCount="indefinite" values="M100 80C120 70 140 90 160 80;M100 80C120 90 140 70 160 80;M100 80C120 70 140 90 160 80"></animate>
                    <animate attributeName="stroke-opacity" dur="2s" repeatCount="indefinite" values="0.3;1;0.3"></animate>
                  </path>
                  
                  {/* Rotating dotted details */}
                  <circle cx="100" cy="100" r="80" stroke="#00F2FF" strokeDasharray="4 8" strokeOpacity="0.25" strokeWidth="1.5">
                    <animateTransform attributeName="transform" dur="12s" from="0 100 100" repeatCount="indefinite" to="360 100 100" type="rotate"></animateTransform>
                  </circle>
                </svg>
              </div>
            </div>
            
            {/* Header branding */}
            <div className="flex flex-col items-center reveal-content" style={{ animationDelay: '0.5s' }}>
              <h1 className="font-headline-lg-mobile text-[40px] leading-tight font-extrabold text-primary tracking-tighter mb-2 drop-shadow-[0_0_15px_rgba(173,198,255,0.4)]">
                PowerGuard
              </h1>
              <p className="font-label-caps text-label-caps text-on-surface-variant tracking-[0.2em] uppercase opacity-80">
                Live Transmission Monitoring
              </p>
            </div>
            
            {/* Progress Bar loader */}
            <div className="absolute bottom-16 w-full px-12 reveal-content" style={{ animationDelay: '0.8s' }}>
              <div className="relative w-full h-[3px] bg-white/5 rounded-full overflow-hidden">
                <div className="absolute top-0 left-0 h-full w-full loading-shimmer"></div>
                <div 
                  className="absolute top-0 left-0 h-full bg-secondary-container shadow-[0_0_10px_#00f1fe] transition-all duration-300 ease-out" 
                  style={{ width: `${splashProgress}%` }}
                ></div>
              </div>
              <div className="mt-4 flex flex-col items-center space-y-2">
                <span className="font-mono-data text-[10px] text-on-surface-variant/60 tracking-widest uppercase">
                  {splashStatus}
                </span>
                <div className="flex items-center space-x-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-secondary-container animate-ping"></div>
                  <span className="font-mono-data text-[10px] text-secondary-container opacity-85 font-bold">GRID MODULE ONLINE</span>
                </div>
              </div>
            </div>
          </main>
        </div>
      )}

      {/* 2. LIVE ALERT OVERLAY - Overlays other views immediately when cut detected and not acknowledged */}
      {statusVal === 'ALERT' && acknowledgedAlertTime === null && autoOpenAlert && currentView !== 'splash' && (
        <div className="fixed inset-0 z-50 w-full min-h-screen flex flex-col items-center justify-center p-container-padding animate-critical-border border-8 overflow-hidden">
          {/* Background Layer: Danger Red Gradient & Warning Stripes */}
          <div className="absolute inset-0 z-0 bg-gradient-to-b from-[#4a0000] via-[#1a0000] to-[#000000]"></div>
          <div className="absolute inset-0 z-10 warning-stripes opacity-35 pointer-events-none"></div>
          
          {/* Content */}
          <div className="relative z-20 w-full max-w-md flex flex-col items-center text-center space-y-stack-gap">
            <div className="mb-4">
              <span className="material-symbols-outlined text-[100px] text-error drop-shadow-[0_0_30px_rgba(255,180,171,0.6)] animate-pulse" style={{ fontVariationSettings: "'FILL' 1" }}>
                emergency_home
              </span>
            </div>
            
            <div className="space-y-2">
              <h1 className="font-headline-lg-mobile text-headline-lg-mobile text-white font-extrabold uppercase tracking-widest leading-tight">
                ⚠ POWER LINE CUT DETECTED
              </h1>
              <p className="font-body-lg text-body-lg text-error-container font-semibold animate-bounce">
                Immediate Action Required
              </p>
            </div>
            
            {/* Station details */}
            <div className="glass-morphism w-full p-5 rounded-xl border border-white/10 shadow-2xl">
              <p className="font-label-caps text-label-caps text-on-surface-variant mb-2">AFFECTED FACILITY</p>
              <p className="font-metric-md text-metric-md text-primary tracking-tight font-bold">
                {stationName} – {transmissionLine}
              </p>
            </div>
            
            {/* Live details grid */}
            <div className="grid grid-cols-2 gap-grid-gutter w-full">
              <div className="glass-panel p-4 rounded-xl border border-white/5 flex flex-col items-start">
                <p className="font-label-caps text-label-caps text-on-surface-variant">TENSION</p>
                <p className="font-mono-data text-4xl text-error font-extrabold mt-1">
                  {tension.toFixed(0)}<span className="text-xl ml-1 font-semibold">N</span>
                </p>
              </div>
              <div className="glass-panel p-4 rounded-xl border border-white/5 flex flex-col items-start justify-center">
                <p className="font-label-caps text-label-caps text-on-surface-variant">TIMESTAMP</p>
                <p className="font-mono-data text-body-lg text-on-surface leading-tight mt-1 text-left">
                  Grid Drop<br/>
                  <span className="text-primary font-bold">{lastCutTime || "Now"}</span>
                </p>
              </div>
            </div>
            
            {/* Actions area */}
            <div className="w-full flex flex-col space-y-4 pt-6">
              <a 
                href={mapsUrl}
                target="_blank"
                rel="noreferrer"
                className="relative h-[56px] w-full bg-gradient-to-r from-error to-error-container text-white font-headline-lg-mobile text-[16px] font-bold rounded-xl shadow-[0_0_20px_rgba(255,0,0,0.5)] active:scale-95 transition-all duration-200 overflow-hidden flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined">map</span>
                VIEW LOCATION
              </a>
              <button 
                onClick={handleAcknowledgeAlert}
                className="glass-panel h-touch-target-min w-full border border-white/20 text-on-surface font-label-caps text-label-caps rounded-xl hover:bg-white/10 active:scale-95 transition-all"
              >
                ACKNOWLEDGE ALERT
              </button>
            </div>
          </div>
          
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[150%] h-[40%] bg-error/15 blur-[120px] rounded-full pointer-events-none"></div>
        </div>
      )}

      {/* HEADER BAR (Visible in app) */}
      {currentView !== 'splash' && (
        <header className="fixed top-0 w-full z-40 bg-surface/90 backdrop-blur-md border-b border-white/5 flex justify-between items-center px-container-padding h-16 w-full">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-primary text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>sensors</span>
            <h1 className="font-headline-lg-mobile text-headline-lg-mobile font-bold text-primary tracking-tight">
              {stationName} – {transmissionLine}
            </h1>
          </div>
          <div className="flex items-center">
            {/* Connection Pip */}
            <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-full border border-white/5">
              <span className={`w-2 h-2 rounded-full ${
                connectionStatus === 'Connected' ? 'bg-green-500 pulsing-dot' :
                connectionStatus === 'Connecting' ? 'bg-orange-500 animate-pulse' : 'bg-red-500'
              }`}></span>
              <span className="font-mono-data text-[10px] text-on-surface-variant font-semibold">
                {connectionStatus}
              </span>
            </div>
          </div>
        </header>
      )}

      {/* 3. MAIN DASHBOARD VIEW */}
      {currentView === 'dashboard' && (
        <main className="flex-grow w-full max-w-md pt-24 pb-32 px-container-padding space-y-stack-gap overflow-y-auto no-scrollbar">
          
          {/* Active Alert Banner if status is ALERT but acknowledged */}
          {statusVal === 'ALERT' && acknowledgedAlertTime !== null && (
            <div className="bg-red-950/80 border border-red-500/30 rounded-xl p-4 flex items-center justify-between shadow-[0_0_15px_rgba(239,68,68,0.2)]">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-red-500 animate-pulse">warning</span>
                <div>
                  <h4 className="text-white text-xs font-bold uppercase tracking-wider">Line Cut Active</h4>
                  <p className="text-[10px] text-red-400">Acknowledged at {acknowledgedAlertTime.toLocaleTimeString()}</p>
                </div>
              </div>
              <a 
                href={mapsUrl} 
                target="_blank" 
                rel="noreferrer"
                className="bg-red-500 text-white font-label-caps text-[10px] px-3 py-1.5 rounded-lg font-bold shadow-md hover:bg-red-600 transition-colors"
              >
                Maps
              </a>
            </div>
          )}

          {/* Large Integrity Status Card */}
          <section className={`glass-card rounded-2xl p-6 flex flex-col items-center justify-center text-center space-y-4 ${statusGlowClass} transition-all duration-500`}>
            <div className={`w-16 h-16 rounded-full ${statusBg} flex items-center justify-center transition-colors duration-500`}>
              <span className={`material-symbols-outlined ${statusTextClass} text-4xl`} style={{ fontVariationSettings: "'FILL' 1" }}>
                {statusIcon}
              </span>
            </div>
            <div>
              <h2 className="font-label-caps text-label-caps text-on-surface-variant mb-1 uppercase tracking-widest font-semibold">
                System Integrity
              </h2>
              <p className={`font-metric-huge text-metric-huge ${statusTextClass} tracking-tight font-extrabold`}>
                {statusVal}
              </p>
            </div>
            <p className="font-body-lg text-body-lg text-on-surface-variant/65">
              {statusVal === 'SAFE' && 'Line tension within nominal limits.'}
              {statusVal === 'WARNING' && 'Caution: Tension dropped below baseline! Check immediately.'}
              {statusVal === 'ALERT' && 'Emergency: Substandard tension/cut detected on grid line!'}
            </p>
          </section>

          {/* Live Tension Metric Card */}
          <section className="glass-card rounded-2xl p-6 overflow-hidden">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="font-label-caps text-label-caps text-on-surface-variant uppercase mb-1 font-semibold">
                  Live Tension
                </h2>
                <p className="font-metric-huge text-metric-huge text-primary font-extrabold tracking-tight">
                  {tension.toFixed(0)} <span className="text-2xl font-bold ml-0.5">N</span>
                </p>
              </div>
              <div className="text-right">
                <span className={`font-label-caps text-label-caps ${
                  statusVal === 'SAFE' ? 'text-green-400' : 'text-error'
                } flex items-center gap-1 justify-end font-bold`}>
                  <span className="material-symbols-outlined text-xs">
                    {statusVal === 'SAFE' ? 'trending_flat' : 'trending_down'}
                  </span>
                  {statusVal === 'SAFE' ? 'STEADY' : 'DANGER'}
                </span>
                <p className="font-label-caps text-[9px] text-on-surface-variant/40 mt-1 font-semibold uppercase tracking-wider">
                  Updated Live
                </p>
              </div>
            </div>

            {/* Live Mini Sparkline Chart */}
            <div className="w-full h-16 mt-4">
              <Sparkline data={history} baseline={baselineVal} />
            </div>
            
            {/* Baseline Info */}
            <div className="mt-4 pt-3 border-t border-white/5 flex justify-between text-[11px] font-mono-data text-on-surface-variant/60">
              <span>Baseline: {baselineVal.toFixed(1)} N</span>
              <span>Min Limit: {(baselineVal * ALERT_THRESHOLD).toFixed(1)} N</span>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-grid-gutter">
            
            {/* Quick Actions (Start/Stop telemetry simulation or physical reads) */}
            <section className="glass-card rounded-2xl p-5 space-y-4">
              <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase font-semibold">
                Node Monitoring Controller
              </h3>
              
              <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${isMonitoring ? 'bg-green-500 pulsing-dot' : 'bg-yellow-500'}`}></span>
                  <span className="font-mono-data text-xs font-semibold uppercase text-on-surface">
                    {isMonitoring ? 'Active Monitoring' : 'Telemetry Paused'}
                  </span>
                </div>
                <div className="flex gap-2">
                  {!isMonitoring ? (
                    <button 
                      onClick={startMonitoring} 
                      className="px-4 py-2 bg-green-500 text-black font-label-caps text-[11px] rounded-lg font-bold shadow-md hover:bg-green-600 transition-colors"
                    >
                      Start
                    </button>
                  ) : (
                    <button 
                      onClick={stopMonitoring} 
                      className="px-4 py-2 bg-yellow-500 text-black font-label-caps text-[11px] rounded-lg font-bold shadow-md hover:bg-yellow-600 transition-colors"
                    >
                      Pause
                    </button>
                  )}
                </div>
              </div>
            </section>

            {/* Substation Location Card with satellite overlay background */}
            <section className="glass-card rounded-2xl overflow-hidden min-h-[150px] relative group border border-white/5">
              <div 
                className="absolute inset-0 z-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-105 opacity-65"
                style={{ 
                  backgroundImage: "url('https://lh3.googleusercontent.com/aida-public/AB6AXuDrKMHFdDVUvk7zqO22QrzTY3h5gERQL9mDcrr9d7Vy5SKciWhhfqz5pYoKbzWrGZc-ngf2mNOReDECkTLoDJxEIdI89VKE-Tt_hYP-uuIOeDenZKzX5Nf8nSd6rnDBKExV8vDf3rlbWlDelLSc0DYkABm7MTBHYsu1xSX_mdvV-jUcfug5vD254-47RL2a6DEyWBw6AsfWpZREXljifxNsxL9DAqUe4tfRka-uuMX64lvRR3qV0uJ1o1cNVkxYb7hoe7UtB2jis3M')"
                }}
              ></div>
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent z-10"></div>
              
              <div className="relative z-20 p-5 h-full flex flex-col justify-between">
                <div className="flex justify-between items-start mb-8">
                  <span className="material-symbols-outlined text-secondary-container" style={{ fontVariationSettings: "'FILL' 1" }}>
                    location_on
                  </span>
                  <p className="font-mono-data text-[10px] text-white bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/5 font-semibold">
                    GPS Coordinates Active
                  </p>
                </div>
                
                <a 
                  href={mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full bg-secondary-container text-on-secondary-container font-label-caps py-2 rounded-xl text-center flex items-center justify-center gap-2 transition-all active:scale-[0.98] status-glow-blue h-touch-target-min font-bold"
                >
                  OPEN IN MAPS
                  <span className="material-symbols-outlined text-sm">open_in_new</span>
                </a>
              </div>
            </section>
          </div>
        </main>
      )}

      {/* 4. SETTINGS VIEW */}
      {currentView === 'settings' && (
        <main className="flex-grow w-full max-w-md pt-24 pb-32 px-container-padding space-y-stack-gap overflow-y-auto no-scrollbar">
          
          <section className="space-y-3">
            <h2 className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest pl-1 font-semibold">
              Station Settings
            </h2>
            <div className="glass-panel p-5 rounded-2xl space-y-5">
              <div className="space-y-1.5">
                <label className="font-label-caps text-[10px] text-on-surface-variant uppercase font-semibold">Station Name</label>
                <input 
                  type="text" 
                  value={tempStationName} 
                  onChange={(e) => setTempStationName(e.target.value)}
                  className="w-full bg-surface-container-lowest border border-white/10 rounded-xl h-12 px-4 text-on-surface font-body-lg focus:outline-none focus:border-secondary-container focus:ring-1 focus:ring-secondary-container"
                />
              </div>
              <div className="space-y-1.5">
                <label className="font-label-caps text-[10px] text-on-surface-variant uppercase font-semibold">Transmission Line Name</label>
                <input 
                  type="text" 
                  value={tempLineName} 
                  onChange={(e) => setTempLineName(e.target.value)}
                  className="w-full bg-surface-container-lowest border border-white/10 rounded-xl h-12 px-4 text-on-surface font-body-lg focus:outline-none focus:border-secondary-container focus:ring-1 focus:ring-secondary-container"
                />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest pl-1 font-semibold">
              Location Settings
            </h2>
            <div className="glass-panel p-5 rounded-2xl space-y-4">
              <div className="space-y-1.5">
                <label className="font-label-caps text-[10px] text-on-surface-variant uppercase font-semibold">Google Maps URL</label>
                <div className="relative">
                  <input 
                    type="text" 
                    value={tempMapsUrl}
                    onChange={(e) => setTempMapsUrl(e.target.value)}
                    placeholder="https://maps.google.com/..."
                    className="w-full bg-surface-container-lowest border border-white/10 rounded-xl h-12 px-4 pr-12 text-on-surface font-mono-data focus:outline-none focus:border-secondary-container focus:ring-1 focus:ring-secondary-container"
                  />
                  <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant" style={{ fontVariationSettings: "'FILL' 1" }}>
                    location_on
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest pl-1 font-semibold">
              Backend Connection
            </h2>
            <div className="glass-panel p-5 rounded-2xl space-y-4">
              <div className="p-3.5 bg-surface-container-lowest rounded-xl border border-white/5 flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${
                  connectionStatus === 'Connected' ? 'bg-green-500 pulsing-dot' : 'bg-red-500'
                }`}></div>
                <div className="flex flex-col">
                  <span className="font-label-caps text-[10px] text-on-surface-variant uppercase font-semibold">Current Backend URL</span>
                  <span className="font-mono-data text-on-surface text-sm break-all font-semibold mt-0.5">{backendUrl}</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="font-label-caps text-[10px] text-on-surface-variant uppercase font-semibold">Change URL</label>
                <input 
                  type="text" 
                  value={manualBackendUrl}
                  onChange={(e) => setManualBackendUrl(e.target.value)}
                  placeholder="http://192.168.1.XX:5000"
                  className="w-full bg-surface-container-lowest border border-white/10 rounded-xl h-12 px-4 text-on-surface font-mono-data focus:outline-none focus:border-secondary-container focus:ring-1 focus:ring-secondary-container"
                />
              </div>
              <button 
                onClick={() => setCurrentView('scanner')}
                className="w-full h-12 bg-white/5 border border-white/10 text-on-surface font-label-caps text-xs font-semibold rounded-xl flex items-center justify-center gap-2 hover:bg-white/10 active:scale-95 transition-all"
              >
                <span className="material-symbols-outlined text-sm">photo_camera</span>
                Scan QR to Connect
              </button>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest pl-1 font-semibold">
              Alert Settings
            </h2>
            <div className="glass-panel rounded-2xl overflow-hidden divide-y divide-white/5">
              <div className="flex items-center justify-between p-5 h-20">
                <div className="flex items-center gap-4">
                  <span className="material-symbols-outlined text-primary text-xl">volume_up</span>
                  <span className="font-body-lg text-on-surface font-medium">Sound Alerts</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={soundEnabled} 
                    onChange={(e) => setSoundEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-14 h-8 bg-surface-container-highest rounded-full p-1 peer-checked:bg-secondary-container peer-checked:shadow-[0_0_10px_rgba(0,241,254,0.5)] transition-all duration-300">
                    <div className="w-6 h-6 bg-white rounded-full transition-transform duration-300 peer-checked:translate-x-6"></div>
                  </div>
                </label>
              </div>
              <div className="flex items-center justify-between p-5 h-20">
                <div className="flex items-center gap-4">
                  <span className="material-symbols-outlined text-primary text-xl">vibration</span>
                  <span className="font-body-lg text-on-surface font-medium">Device Vibration</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={vibrationEnabled} 
                    onChange={(e) => setVibrationEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-14 h-8 bg-surface-container-highest rounded-full p-1 peer-checked:bg-secondary-container peer-checked:shadow-[0_0_10px_rgba(0,241,254,0.5)] transition-all duration-300">
                    <div className="w-6 h-6 bg-white rounded-full transition-transform duration-300 peer-checked:translate-x-6"></div>
                  </div>
                </label>
              </div>
              <div className="flex items-center justify-between p-5 h-20">
                <div className="flex items-center gap-4">
                  <span className="material-symbols-outlined text-primary text-xl">open_in_new</span>
                  <span className="font-body-lg text-on-surface font-medium">Auto Open Alarm</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={autoOpenAlert} 
                    onChange={(e) => setAutoOpenAlert(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-14 h-8 bg-surface-container-highest rounded-full p-1 peer-checked:bg-secondary-container peer-checked:shadow-[0_0_10px_rgba(0,241,254,0.5)] transition-all duration-300">
                    <div className="w-6 h-6 bg-white rounded-full transition-transform duration-300 peer-checked:translate-x-6"></div>
                  </div>
                </label>
              </div>
            </div>
          </section>

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-4 pt-4">
            <button 
              onClick={() => setCurrentView('dashboard')}
              className="h-12 bg-white/5 border border-white/10 text-on-surface font-label-caps text-xs font-semibold rounded-xl hover:bg-white/10 active:scale-95 transition-all"
            >
              Cancel
            </button>
            <button 
              onClick={handleSaveSettings}
              className="h-12 bg-secondary-container text-on-secondary-container font-label-caps text-xs font-bold rounded-xl active:scale-[0.98] shadow-md transition-all"
            >
              Save Settings
            </button>
          </div>

          <div className="pt-4 pb-8 flex flex-col items-center gap-1.5 opacity-40">
            <span className="font-label-caps text-[9px] font-bold">PowerGuard Mobile Monitor v4.2.0</span>
            <span className="font-mono-data text-[9px]">Hardware Ref: ESP32-C3-TENSION-CELL</span>
          </div>
        </main>
      )}

      {/* 5. SCANNER VIEW */}
      {currentView === 'scanner' && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col justify-between overflow-hidden">
          
          <header className="bg-surface/90 backdrop-blur-md flex justify-between items-center px-container-padding h-16 border-b border-white/5 w-full">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-primary text-2xl">photo_camera</span>
              <h1 className="font-headline-lg-mobile text-headline-lg-mobile font-bold text-primary tracking-tight">QR Link Linker</h1>
            </div>
            <button 
              onClick={() => setCurrentView('settings')}
              className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container-high transition-colors text-white"
            >
              <span className="material-symbols-outlined text-2xl">close</span>
            </button>
          </header>

          <main className="flex-grow flex flex-col items-center justify-center px-container-padding pb-8">
            <div className="mb-6 text-center space-y-1.5">
              <p className="font-label-caps text-label-caps text-secondary-container tracking-widest uppercase font-bold">Camera Scan Mode</p>
              <h2 className="text-white text-lg font-bold">Align with terminal QR code</h2>
            </div>

            {/* Scanner Container wrapper */}
            <div className="relative w-72 h-72 border border-white/20 rounded-2xl overflow-hidden bg-black/45 shadow-[0_0_30px_rgba(0,242,255,0.1)] flex items-center justify-center p-4">
              {/* Corner Indicators */}
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-secondary-container rounded-tl-xl z-20"></div>
              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-secondary-container rounded-tr-xl z-20"></div>
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-secondary-container rounded-bl-xl z-20"></div>
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-secondary-container rounded-br-xl z-20"></div>
              
              {!cameraError && (
                <div className="absolute w-[90%] left-[5%] h-0.5 bg-secondary-container shadow-[0_0_12px_#00f1fe] animate-scan z-10"></div>
              )}
              
              {cameraError ? (
                <div className="text-center z-20 space-y-2 p-2 flex flex-col items-center">
                  <span className="material-symbols-outlined text-orange-500 text-3xl">warning</span>
                  <p className="text-xs text-on-surface-variant font-medium leading-relaxed whitespace-pre-line">{cameraError}</p>
                </div>
              ) : (
                /* Real html5-qrcode element */
                <div id="qr-reader-element" className="w-full h-full object-cover"></div>
              )}
            </div>

            {/* Manual input fallback */}
            <div className="mt-8 w-full max-w-sm glass-panel p-5 rounded-2xl space-y-4">
              <h4 className="font-label-caps text-[10px] text-on-surface-variant uppercase font-semibold">Or enter link manually</h4>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  placeholder="http://192.168.1.XX:5000" 
                  value={manualBackendUrl}
                  onChange={(e) => setManualBackendUrl(e.target.value)}
                  className="flex-grow bg-surface-container-lowest border border-white/10 rounded-xl h-10 px-3 text-on-surface font-mono-data text-xs focus:outline-none focus:border-secondary-container"
                />
                <button 
                  onClick={() => {
                    localStorage.setItem('backend_url', manualBackendUrl);
                    setBackendUrl(manualBackendUrl);
                    setCurrentView('settings');
                  }}
                  className="px-4 bg-secondary-container text-on-secondary-container font-label-caps text-[11px] rounded-xl font-bold active:scale-95"
                >
                  Connect
                </button>
              </div>
            </div>
          </main>
        </div>
      )}

      {/* BOTTOM TAB NAVIGATION (Only visible on dashboard or settings) */}
      {(currentView === 'dashboard' || currentView === 'settings') && (
        <nav className="fixed bottom-0 w-full z-40 flex justify-around items-center px-container-padding pb-safe-area-bottom h-touch-target-min bg-[#131313]/90 backdrop-blur-xl border-t border-white/5 shadow-[0_-4px_25px_rgba(0,0,0,0.6)]">
          {/* Dashboard tab */}
          <button 
            onClick={() => setCurrentView('dashboard')}
            className={`flex flex-col items-center justify-center p-2 rounded-xl scale-95 active:scale-90 transition-transform duration-200 cursor-pointer ${
              currentView === 'dashboard' 
                ? 'bg-secondary-container/20 text-secondary-container shadow-[0_0_10px_rgba(0,241,254,0.3)]' 
                : 'text-on-surface-variant hover:text-white'
            }`}
          >
            <span className="material-symbols-outlined" style={{ fontVariationSettings: currentView === 'dashboard' ? "'FILL' 1" : "'FILL' 0" }}>
              dashboard
            </span>
            <span className="font-label-caps text-[9px] mt-1 font-bold">Dashboard</span>
          </button>
          
          {/* Settings tab */}
          <button 
            onClick={enterSettings}
            className={`flex flex-col items-center justify-center p-2 rounded-xl scale-95 active:scale-90 transition-transform duration-200 cursor-pointer ${
              currentView === 'settings' 
                ? 'bg-secondary-container/20 text-secondary-container shadow-[0_0_10px_rgba(0,241,254,0.3)]' 
                : 'text-on-surface-variant hover:text-white'
            }`}
          >
            <span className="material-symbols-outlined" style={{ fontVariationSettings: currentView === 'settings' ? "'FILL' 1" : "'FILL' 0" }}>
              settings
            </span>
            <span className="font-label-caps text-[9px] mt-1 font-bold">Settings</span>
          </button>
        </nav>
      )}
    </div>
  );
}

export default App;
