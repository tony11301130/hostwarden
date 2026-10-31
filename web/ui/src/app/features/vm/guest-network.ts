/** IPv4 settings applied to one guest interface on its first boot. */
export interface GuestNetworkSettings {
  mode: 'dhcp' | 'static';
  interfaceName: string;
  address: string;
  subnet: string;
  gateway: string;
  dns: string;
}

function ipv4(value: string): number | null {
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((address, part) => address * 256 + Number(part), 0);
}

/** Accept a prefix length (24 or /24) or a contiguous dotted subnet mask. */
function prefixLength(value: string): number | null {
  const subnet = value.trim();
  if (/^\/?(0|[1-9]\d?)$/.test(subnet)) {
    const prefix = Number(subnet.replace('/', ''));
    return prefix <= 32 ? prefix : null;
  }
  const mask = ipv4(subnet);
  if (mask === null) return null;
  const bits = mask.toString(2).padStart(32, '0');
  if (!/^1*0*$/.test(bits)) return null;
  const firstZero = bits.indexOf('0');
  return firstZero === -1 ? 32 : firstZero;
}

function unicast(value: string): number | null {
  const address = ipv4(value);
  if (address === null) return null;
  const first = Math.floor(address / 2 ** 24);
  return first === 0 || first === 127 || first >= 224 ? null : address;
}

function dnsServers(value: string): string[] {
  return value.trim().split(/[\s,]+/).filter(Boolean);
}

export function guestNetworkError(settings: GuestNetworkSettings): string | null {
  if (settings.mode === 'dhcp') return null;
  const name = settings.interfaceName.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,14}$/.test(name) || name === 'lo') {
    return 'Enter the guest network interface name, for example ens192, ens160 or eth0.';
  }
  const address = unicast(settings.address.trim());
  if (address === null) return 'Enter a valid unicast IPv4 address, for example 192.168.1.100.';
  const prefix = prefixLength(settings.subnet);
  if (prefix === null) return 'Enter a subnet mask such as 255.255.255.0, or a prefix from /0 to /32.';
  const size = 2 ** (32 - prefix);
  const network = Math.floor(address / size) * size;
  if (prefix <= 30 && (address === network || address === network + size - 1)) {
    return 'The IPv4 address must not be the subnet network or broadcast address.';
  }
  if (settings.gateway.trim()) {
    const gateway = unicast(settings.gateway.trim());
    if (gateway === null) return 'Enter a valid IPv4 default gateway, or leave it empty for an isolated network.';
    if (gateway === address) return 'The default gateway must be different from the guest IPv4 address.';
    if (Math.floor(gateway / size) * size !== network) return 'The default gateway must be in the same subnet as the guest IPv4 address.';
    if (prefix <= 30 && (gateway === network || gateway === network + size - 1)) {
      return 'The default gateway must not be the subnet network or broadcast address.';
    }
  }
  if (dnsServers(settings.dns).some((server) => unicast(server) === null)) {
    return 'Enter valid IPv4 DNS servers separated by commas or spaces.';
  }
  return null;
}

/** NoCloud takes network-config separately from user-data; DHCP keeps its default behavior. */
export function buildGuestNetworkConfig(settings: GuestNetworkSettings): string | undefined {
  if (settings.mode === 'dhcp') return undefined;
  const error = guestNetworkError(settings);
  if (error) throw new Error(error);
  const lines = [
    'version: 2',
    'ethernets:',
    `  ${JSON.stringify(settings.interfaceName.trim())}:`,
    '    dhcp4: false',
    '    addresses:',
    `      - ${JSON.stringify(`${settings.address.trim()}/${prefixLength(settings.subnet)}`)}`,
  ];
  if (settings.gateway.trim()) {
    lines.push('    routes:', '      - to: "0.0.0.0/0"', `        via: ${JSON.stringify(settings.gateway.trim())}`);
  }
  const dns = dnsServers(settings.dns);
  if (dns.length) lines.push('    nameservers:', `      addresses: ${JSON.stringify(dns)}`);
  return lines.join('\n') + '\n';
}
