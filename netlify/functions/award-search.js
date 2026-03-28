/**
 * Netlify Function: award-search
 * Proxies Seats.aero Cached Search API
 *
 * TWO ACCESS MODES:
 *
 * Mode A — Partner API key (for your own searches, non-commercial personal use)
 *   Set SEATS_AERO_API_KEY in Netlify environment variables.
 *   Get key: seats.aero Pro subscription → Settings → API tab
 *
 * Mode B — User OAuth token (Login with Seats.aero)
 *   User connects their own Pro account via OAuth.
 *   Pass { userToken: "..." } in the request body.
 *   Each user's own subscription covers their searches — no commercial use issues.
 *   OAuth flow: https://developers.seats.aero/reference/overview
 *
 * Seats.aero docs: https://developers.seats.aero/reference/cached-search
 *
 * Request body:
 *   { origin, destination, startDate, endDate?, cabins?, userToken? }
 *
 * Returns:
 *   { awards: [...], meta: { ... } }
 */

const SEATS_BASE = 'https://seats.aero/partnerapi';

// Seats.aero program sources — map from loyalty program name to API source key
const PROGRAM_SOURCES = {
  'Air Canada Aeroplan':         'aeroplan',
  'Alaska Mileage Plan':         'alaska',
  'American AAdvantage':         'american',
  'Delta SkyMiles':              'delta',
  'United MileagePlus':          'united',
  'JetBlue TrueBlue':            'jetblue',
  'Air France Flying Blue':      'flyingblue',
  'Emirates Skywards':           'emirates',
  'Lufthansa Miles & More':      'lufthansa',
  'Qantas Frequent Flyer':       'qantas',
  'Qatar Privilege Club':        'qatar',
  'Singapore KrisFlyer':         'singapore',
  'Turkish Miles&Smiles':        'turkish',
  'Virgin Atlantic Flying Club': 'virginatlantic',
  'British Airways Avios':       'aeroplan', // BA Avios often bookable via Aeroplan
  'Southwest Rapid Rewards':     'american', // no direct source; show cash fares
};

export const handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const {
    origin,       // IATA airport code e.g. "JFK"
    destination,  // e.g. "MSP"
    startDate,    // YYYY-MM-DD
    endDate,      // YYYY-MM-DD (optional — defaults to startDate + 1 day)
    cabins,       // comma-separated: "business,first" or "economy"
    sources,      // comma-separated program sources to search e.g. "aeroplan,united"
    userToken,    // OAuth token from user's Seats.aero account (Mode B)
  } = body;

  if (!origin || !destination || !startDate) return {
    statusCode: 400, headers: cors,
    body: JSON.stringify({ error: 'origin, destination, and startDate are required' }),
  };

  // Determine API key — user OAuth token takes priority, else partner key
  const partnerKey = process.env.SEATS_AERO_API_KEY;
  const authToken  = userToken || partnerKey;

  if (!authToken) return {
    statusCode: 401, headers: cors,
    body: JSON.stringify({
      error: 'no_auth',
      message: 'No Seats.aero credentials available. Either set SEATS_AERO_API_KEY in environment variables (personal use), or connect your Seats.aero Pro account via OAuth.',
      oauthUrl: 'https://developers.seats.aero/reference/overview',
    }),
  };

  try {
    // Cached Search — fast, returns pre-computed award availability
    const params = new URLSearchParams({
      origin_airport: origin,
      destination_airport: destination,
      start_date: startDate,
      end_date: endDate || startDate,
    });
    if (cabins) params.set('cabin', cabins);
    if (sources) params.set('source', sources);

    const res = await fetch(`${SEATS_BASE}/search?${params}`, {
      headers: {
        'Partner-Authorization': authToken,
        'Accept': 'application/json',
      },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err?.message || res.statusText;

      // Handle common errors
      if (res.status === 401) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Invalid or expired Seats.aero token. Reconnect your account.' }) };
      if (res.status === 403) return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'Seats.aero Pro subscription required for API access. Visit seats.aero to subscribe.' }) };
      if (res.status === 429) return { statusCode: 429, headers: cors, body: JSON.stringify({ error: 'Seats.aero rate limit reached. Try again in a few minutes.' }) };

      return { statusCode: res.status, headers: cors, body: JSON.stringify({ error: `Seats.aero error: ${msg}` }) };
    }

    const data = await res.json();
    const raw = data?.data || [];

    // Normalise into PayMax award shape
    const awards = raw.flatMap(item => normaliseAvailability(item)).slice(0, 20);

    return {
      statusCode: 200, headers: cors,
      body: JSON.stringify({
        awards,
        meta: {
          count: awards.length,
          origin,
          destination,
          startDate,
          endDate: endDate || startDate,
          source: 'seats.aero',
          authMode: userToken ? 'user_oauth' : 'partner_key',
        },
      }),
    };

  } catch (err) {
    console.error('award-search:', err);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};

/**
 * Normalise a Seats.aero availability object into PayMax's award shape.
 * Returns one entry per cabin class available.
 */
function normaliseAvailability(item) {
  const results = [];
  const cabinMap = {
    YAvailable: { cabin: 'Economy',          pointsField: 'YMileageCost',  seatsField: 'YRemainingSeats' },
    WAvailable: { cabin: 'Premium Economy',  pointsField: 'WMileageCost',  seatsField: 'WRemainingSeats' },
    JAvailable: { cabin: 'Business',         pointsField: 'JMileageCost',  seatsField: 'JRemainingSeats' },
    FAvailable: { cabin: 'First',            pointsField: 'FMileageCost',  seatsField: 'FRemainingSeats' },
  };

  for (const [availKey, { cabin, pointsField, seatsField }] of Object.entries(cabinMap)) {
    if (!item[availKey]) continue;

    const pointsCost = item[pointsField];
    const seats = item[seatsField];

    results.push({
      id:          item.ID,
      source:      item.Source,           // e.g. "aeroplan"
      programName: sourceToProgram(item.Source),
      origin:      item.OriginAirport,
      destination: item.DestinationAirport,
      date:        item.Date,
      cabin,
      pointsCost:  pointsCost ? parseInt(pointsCost) : null,
      seats:       seats ? parseInt(seats) : null,
      available:   true,
      // Trip ID can be used to get detailed segment/flight info
      tripId:      item.ID,
    });
  }

  return results;
}

function sourceToProgram(source) {
  const map = {
    aeroplan: 'Air Canada Aeroplan',
    alaska: 'Alaska Mileage Plan',
    american: 'American AAdvantage',
    delta: 'Delta SkyMiles',
    united: 'United MileagePlus',
    jetblue: 'JetBlue TrueBlue',
    flyingblue: 'Air France Flying Blue',
    emirates: 'Emirates Skywards',
    lufthansa: 'Lufthansa Miles & More',
    qantas: 'Qantas Frequent Flyer',
    qatar: 'Qatar Privilege Club',
    singapore: 'Singapore KrisFlyer',
    turkish: 'Turkish Miles&Smiles',
    virginatlantic: 'Virgin Atlantic Flying Club',
  };
  return map[source] || source;
}
