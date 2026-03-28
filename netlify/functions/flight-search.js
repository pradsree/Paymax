/**
 * Netlify Function: flight-search
 * Proxies Duffel Flight Offers API
 *
 * SETUP — add in Netlify → Site settings → Environment variables:
 *   DUFFEL_API_KEY = your Duffel access token
 *
 * Get key:
 *   1. https://app.duffel.com/join  (1 min signup)
 *   2. Dashboard → More → Developers → Access tokens → Create test token
 *   3. Token starts with "duffel_test_..." for sandbox, "duffel_live_..." for production
 *
 * Duffel docs: https://duffel.com/docs/guides/getting-started-with-flights
 *
 * Request body: { origin, destination, departureDate, returnDate?, adults, cabinClass? }
 * Response:     { flights: [...], meta: { ... } }
 */

const DUFFEL_BASE = 'https://api.duffel.com';

export const handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };

  const apiKey = process.env.DUFFEL_API_KEY;
  if (!apiKey) return {
    statusCode: 500, headers: cors,
    body: JSON.stringify({ error: 'DUFFEL_API_KEY not set in Netlify environment variables. Get your key at https://app.duffel.com → Developers → Access tokens.' }),
  };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { origin, destination, departureDate, returnDate, adults = 1, cabinClass = 'economy', maxOffers = 12 } = body;

  if (!origin || !destination || !departureDate) return {
    statusCode: 400, headers: cors,
    body: JSON.stringify({ error: 'origin, destination, and departureDate are required' }),
  };

  // Build slices — Duffel supports city codes (NYC) and airport codes (JFK)
  const slices = [{ origin, destination, departure_date: departureDate }];
  if (returnDate) slices.push({ origin: destination, destination: origin, departure_date: returnDate });

  const passengers = Array.from({ length: Math.min(adults, 9) }, () => ({ type: 'adult' }));

  try {
    const res = await fetch(`${DUFFEL_BASE}/air/offer_requests?return_offers=true`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Duffel-Version': 'v2',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ data: { slices, passengers, cabin_class: cabinClass } }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err?.errors?.[0]?.message || err?.errors?.[0]?.title || res.statusText;
      return { statusCode: res.status, headers: cors, body: JSON.stringify({ error: `Duffel: ${msg}` }) };
    }

    const data = await res.json();
    const offers = (data?.data?.offers || [])
      .sort((a, b) => parseFloat(a.total_amount) - parseFloat(b.total_amount))
      .slice(0, maxOffers);

    return {
      statusCode: 200, headers: cors,
      body: JSON.stringify({
        flights: offers.map(normalise),
        meta: { count: offers.length, origin, destination, departureDate, returnDate: returnDate || null, cabinClass, source: 'duffel', offerRequestId: data?.data?.id },
      }),
    };

  } catch (err) {
    console.error('flight-search:', err);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};

function parseDuration(iso = '') {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  return ((m?.[1] ? `${m[1]}h ` : '') + (m?.[2] ? `${m[2]}m` : '')).trim() || iso;
}

function fmtTime(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' }); }
  catch { return iso.slice(11, 16); }
}

/**
 * Normalise a Duffel offer into PayMax's expected shape.
 * NOTE: US DOT regulations require operating_carrier.name to be displayed
 * prominently on the first screen showing the offer. The `operatingCarrier`
 * field below must be shown in the UI.
 */
function normalise(offer) {
  const outSlice = offer.slices[0];
  const segs = outSlice.segments;
  const first = segs[0];
  const last  = segs[segs.length - 1];
  const stops = segs.length - 1;
  const carrier = first.operating_carrier || first.marketing_carrier || {};
  const mktCarrier = first.marketing_carrier || {};

  return {
    id:              offer.id,
    offerId:         offer.id,          // keep for booking (create order)
    passengerIds:    (offer.passengers || []).map(p => p.id),
    airline:         carrier.name || carrier.iata_code || 'Unknown',
    airlineCode:     carrier.iata_code || mktCarrier.iata_code,
    operatingCarrier:carrier.name || carrier.iata_code,  // REQUIRED by US DOT regs
    flightNumber:    `${mktCarrier.iata_code || ''}${first.marketing_carrier_flight_number || ''}`,
    from:            first.origin.iata_code,
    fromCity:        first.origin.city_name || first.origin.iata_code,
    to:              last.destination.iata_code,
    toCity:          last.destination.city_name || last.destination.iata_code,
    departure:       first.departing_at,
    arrival:         last.arriving_at,
    departureTime:   fmtTime(first.departing_at),
    arrivalTime:     fmtTime(last.arriving_at),
    duration:        parseDuration(outSlice.duration),
    stops:           stops === 0 ? 'Nonstop' : stops === 1 ? `1 stop via ${segs[0].destination.iata_code}` : `${stops} stops`,
    cabin:           first.passengers?.[0]?.cabin_class_marketing_name || first.passengers?.[0]?.cabin_class || 'Economy',
    baggage:         (() => { const b = first.passengers?.[0]?.baggages?.[0]; return b ? `${b.quantity}× checked bag included` : 'Bags not included'; })(),
    cashPrice:       parseFloat(offer.total_amount),
    currency:        offer.total_currency,
    expiresAt:       offer.expires_at,  // offers expire ~30 min — refresh before booking
    segments: segs.map(s => ({
      from:         s.origin.iata_code,
      to:           s.destination.iata_code,
      departing:    s.departing_at,
      arriving:     s.arriving_at,
      carrier:      (s.operating_carrier || s.marketing_carrier)?.name,
      flightNumber: `${s.marketing_carrier?.iata_code || ''}${s.marketing_carrier_flight_number || ''}`,
      duration:     parseDuration(s.duration),
      aircraft:     s.aircraft?.iata_code,
    })),
  };
}
