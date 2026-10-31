import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGuestNetworkConfig, guestNetworkError } from '../src/app/features/vm/guest-network.ts';

const settings = {
  mode: 'static',
  interfaceName: 'ens192',
  address: '192.168.1.100',
  subnet: '24',
  gateway: '192.168.1.1',
  dns: '192.168.1.1, 1.1.1.1',
};

test('DHCP omits network-config, including stale invalid static fields', () => {
  const dhcp = { ...settings, mode: 'dhcp', interfaceName: '', address: 'invalid', subnet: '' };
  assert.equal(guestNetworkError(dhcp), null);
  assert.equal(buildGuestNetworkConfig(dhcp), undefined);
});

test('static configuration uses a separate NoCloud v2 document with IPv4 default route and DNS', () => {
  assert.equal(buildGuestNetworkConfig(settings), `version: 2
ethernets:
  "ens192":
    dhcp4: false
    addresses:
      - "192.168.1.100/24"
    routes:
      - to: "0.0.0.0/0"
        via: "192.168.1.1"
    nameservers:
      addresses: ["192.168.1.1","1.1.1.1"]
`);
});

test('all contiguous dotted masks produce the equivalent CIDR prefix', () => {
  for (let prefix = 0; prefix <= 32; prefix++) {
    const mask = [0, 1, 2, 3].map((octet) => {
      const bits = Math.min(8, Math.max(0, prefix - octet * 8));
      return 256 - 2 ** (8 - bits);
    }).join('.');
    const values = { ...settings, address: '10.20.30.45', gateway: '' };
    const expected = buildGuestNetworkConfig({ ...values, subnet: String(prefix) });
    assert.equal(buildGuestNetworkConfig({ ...values, subnet: `/${prefix}` }), expected);
    assert.equal(buildGuestNetworkConfig({ ...values, subnet: mask }), expected);
  }
});

test('whitespace is trimmed and DNS accepts comma, space and newline separators', () => {
  const padded = Object.fromEntries(Object.entries(settings).map(([key, value]) => [key, key === 'mode' ? value : ` ${value} `]));
  padded.dns = ' 192.168.1.1,\n 1.1.1.1 ';
  assert.equal(buildGuestNetworkConfig(padded), buildGuestNetworkConfig(settings));
});

test('isolated networks may omit the gateway and DNS', () => {
  const config = buildGuestNetworkConfig({ ...settings, gateway: ' ', dns: ' ' });
  assert.doesNotMatch(config, /routes:|nameservers:/);
  assert.match(config, /192\.168\.1\.100\/24/);
});

test('31-bit point-to-point and 32-bit host addresses are allowed', () => {
  assert.equal(guestNetworkError({ ...settings, subnet: '/31', gateway: '192.168.1.101' }), null);
  assert.equal(guestNetworkError({ ...settings, subnet: '/32', gateway: '' }), null);
});

const invalid = [
  ['interfaceName', ''], ['interfaceName', 'lo'], ['interfaceName', 'en*'],
  ['interfaceName', 'a'.repeat(16)], ['interfaceName', 'ens192:\ninvalid'],
  ['address', ''], ['address', '192.168.1.256'], ['address', '192.168.001.1'],
  ['address', '192.168.1.100/24'], ['address', '192.168.1.0'], ['address', '192.168.1.255'],
  ['address', '0.0.0.0'], ['address', '127.0.0.1'], ['address', '224.0.0.1'],
  ['subnet', ''], ['subnet', '/33'], ['subnet', '-1'], ['subnet', '24.5'],
  ['subnet', '255.0.255.0'], ['subnet', '255.255.255.1'], ['subnet', '255.255.255.256'],
  ['gateway', 'invalid'], ['gateway', '192.168.2.1'], ['gateway', '192.168.1.100'],
  ['gateway', '192.168.1.0'], ['gateway', '192.168.1.255'],
  ['dns', '1.1.1.1, invalid'], ['dns', '1.1.1.256'], ['dns', '224.0.0.1'],
];
for (const [field, value] of invalid) {
  test(`invalid ${field} ${JSON.stringify(value)} cannot generate a network configuration`, () => {
    const input = { ...settings, [field]: value };
    assert.ok(guestNetworkError(input));
    assert.throws(() => buildGuestNetworkConfig(input));
  });
}
