const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8085;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to enable CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Proxy endpoint for dump1090 aircraft data
app.get('/api/telemetry', async (req, res) => {
  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing target dump1090 URL in query parameter "url"' });
  }

  try {
    // Format the URL - ensure it has a protocol and ends with data/aircraft.json
    let aircraftUrl = targetUrl;
    if (!/^https?:\/\//i.test(aircraftUrl)) {
      aircraftUrl = 'http://' + aircraftUrl;
    }
    
    // Clean up trailing slash and append paths if not already there
    aircraftUrl = aircraftUrl.replace(/\/+$/, '');
    if (!aircraftUrl.endsWith('aircraft.json')) {
      if (aircraftUrl.endsWith('/data')) {
        aircraftUrl += '/aircraft.json';
      } else {
        aircraftUrl += '/data/aircraft.json';
      }
    }

    const response = await fetch(aircraftUrl, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(502).json({ 
      error: 'Failed to connect to dump1090 server', 
      details: error.message,
      target: req.query.url 
    });
  }
});

// Proxy endpoint for dump1090 receiver config data
app.get('/api/receiver', async (req, res) => {
  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing target dump1090 URL in query parameter "url"' });
  }

  try {
    let receiverUrl = targetUrl;
    if (!/^https?:\/\//i.test(receiverUrl)) {
      receiverUrl = 'http://' + receiverUrl;
    }
    
    receiverUrl = receiverUrl.replace(/\/+$/, '');
    if (!receiverUrl.endsWith('receiver.json')) {
      if (receiverUrl.endsWith('/data')) {
        receiverUrl += '/receiver.json';
      } else {
        receiverUrl += '/data/receiver.json';
      }
    }

    const response = await fetch(receiverUrl, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(502).json({ 
      error: 'Failed to connect to dump1090 server', 
      details: error.message,
      target: req.query.url
    });
  }
});

// Fallback all routes to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`================================================================`);
  console.log(`   SKYVIEW TACTICAL FLIGHT TRACKER - LOCAL PORTAL STARTED      `);
  console.log(`   URL: http://localhost:${PORT}                               `);
  console.log(`================================================================`);
  console.log(`   Press Ctrl+C to stop the server.                            `);
});
