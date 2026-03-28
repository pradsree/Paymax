/**
 * Netlify Function: flight-book
 * Creates a Duffel order (books the flight)
 *
 * Same DUFFEL_API_KEY env var as flight-search.
 *
 * Request body:
 *   {
 *     offerId,         // from flight-search response
 *     passengerIds,    // from flight-search response
 *     passengers: [{   // one per passenger
 *       id,            // passengerIds[i]
 *       given_name, family_name, born_on, gender, title,
 *       email, phone_number
 *     }],
 *     totalAmount,     // offer total_amount (reconfirm before charging)
 *     totalCurrency,   // offer total_currency
 *   }
 *
 * Returns:
 *   { booking: { id, bookingReference, status, ... } }
 *
 * IMPORTANT: Duffel requires you to charge the customer BEFORE calling this
 * endpoint. Use Duffel's payment components or your own payment processor.
 * See: https://duffel.com/docs/guides/collecting-customer-card-payments
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
  if (!apiKey) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'DUFFEL_API_KEY not set' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { offerId, passengers, totalAmount, totalCurrency } = body;

  if (!offerId || !passengers?.length || !totalAmount || !totalCurrency) return {
    statusCode: 400, headers: cors,
    body: JSON.stringify({ error: 'offerId, passengers, totalAmount, and totalCurrency are required' }),
  };

  try {
    // Step 1: Refresh the offer to get current price (offers expire ~30 min)
    const refreshRes = await fetch(`${DUFFEL_BASE}/air/offers/${offerId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Duffel-Version': 'v2', 'Accept': 'application/json' },
    });
    if (!refreshRes.ok) {
      const err = await refreshRes.json().catch(() => ({}));
      return { statusCode: 410, headers: cors, body: JSON.stringify({ error: 'Offer has expired or is no longer available. Please search again.' }) };
    }
    const refreshed = await refreshRes.json();
    const currentPrice = refreshed?.data?.total_amount;
    const currentCurrency = refreshed?.data?.total_currency;

    // Price check — warn if price changed since user saw it
    const priceDiff = Math.abs(parseFloat(currentPrice) - parseFloat(totalAmount));
    if (priceDiff > 0.01) {
      return {
        statusCode: 409, headers: cors,
        body: JSON.stringify({
          error: 'price_changed',
          message: `The price changed from ${totalCurrency} ${totalAmount} to ${currentCurrency} ${currentPrice}. Please confirm the new price before booking.`,
          newPrice: currentPrice,
          newCurrency: currentCurrency,
        }),
      };
    }

    // Step 2: Create order
    // Payment type 'balance' uses your Duffel account balance.
    // For card payments, collect payment first via Duffel's component,
    // then pass the payment_intent_id here instead.
    const orderRes = await fetch(`${DUFFEL_BASE}/air/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Duffel-Version': 'v2',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        data: {
          selected_offers: [offerId],
          passengers: passengers.map(p => ({
            id:           p.id,
            given_name:   p.given_name,
            family_name:  p.family_name,
            born_on:      p.born_on,
            gender:       p.gender,
            title:        p.title,
            email:        p.email,
            phone_number: p.phone_number,
          })),
          payments: [{
            type:     'balance',
            currency: currentCurrency,
            amount:   currentPrice,
          }],
        },
      }),
    });

    if (!orderRes.ok) {
      const err = await orderRes.json().catch(() => ({}));
      const msg = err?.errors?.[0]?.message || err?.errors?.[0]?.title || orderRes.statusText;
      return { statusCode: orderRes.status, headers: cors, body: JSON.stringify({ error: `Booking failed: ${msg}` }) };
    }

    const orderData = await orderRes.json();
    const order = orderData?.data;

    return {
      statusCode: 200, headers: cors,
      body: JSON.stringify({
        booking: {
          id:               order.id,
          bookingReference: order.booking_reference,
          status:           'confirmed',
          totalAmount:      order.total_amount,
          totalCurrency:    order.total_currency,
          passengers:       order.passengers?.map(p => ({ id: p.id, name: `${p.given_name} ${p.family_name}` })),
          slices:           order.slices?.map(s => ({
            from:      s.segments?.[0]?.origin?.iata_code,
            to:        s.segments?.[s.segments.length - 1]?.destination?.iata_code,
            departure: s.segments?.[0]?.departing_at,
          })),
        },
      }),
    };

  } catch (err) {
    console.error('flight-book:', err);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
