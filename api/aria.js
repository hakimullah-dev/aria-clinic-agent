export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const response = await fetch('https://n8n.srv1504760.hstgr.cloud/webhook/aria-agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req.body || {})
  });

  const text = await response.text();
  
  try {
    const data = JSON.parse(text);
    return res.status(200).json(data);
  } catch (e) {
    return res.status(200).send(text);
  }
}