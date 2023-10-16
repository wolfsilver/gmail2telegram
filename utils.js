import { sha256 } from 'js-sha256';

export function hmacSha256(key, data, hex) {
  const hash = sha256.hmac.create(key);
  hash.update(data);
  if (hex) {
    return hash.hex();
  }
  return hash.arrayBuffer();
}

export function checkSignature(origin, token) {
  origin = decodeURIComponent(origin)

  let checkString = [];
  let signature = '';
  let timeStamp = 0;
  origin.split('&').forEach(el => {
    if (el.startsWith('hash=')) {
      signature = el.substring(5)
      return;
    }
    if (el.startsWith('auth_date=')) {
      timeStamp = el.substring(10)
    }
    checkString.push(el)
  })
  if (Math.abs(Date.now() - timeStamp * 1000) > 300000) {
    return false;
  }

  checkString = checkString.sort().join('\n')

  const secret_key = hmacSha256("WebAppData", token)
  const hash = hmacSha256(secret_key, checkString, 'hex')
  return signature === hash
}
