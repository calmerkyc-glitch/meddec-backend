import http from 'http';

const data = JSON.stringify({ email: 'admin@meddec.com', password: 'admin123' });
const options = {
  hostname: 'localhost',
  port: 5000,
  path: '/api/auth/signin',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  },
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => (body += chunk));
  res.on('end', () => {
    console.log('STATUS:', res.statusCode);
    console.log('BODY:', body);
  });
});

req.on('error', (err) => {
  console.error('REQUEST ERROR:', err.message);
});

req.write(data);
req.end();
