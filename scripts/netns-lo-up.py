"""Brings the loopback interface up inside a fresh network namespace (no `ip` tool needed).
Used by scripts/verify-offline.sh: `unshare -rn python3 scripts/netns-lo-up.py <command...>` runs <command> with ONLY localhost."""
import fcntl, os, socket, struct, sys
SIOCGIFFLAGS, SIOCSIFFLAGS, IFF_UP = 0x8913, 0x8914, 0x1
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
req = struct.pack("16sH14s", b"lo", 0, b"")
flags = struct.unpack("16sH14s", fcntl.ioctl(s, SIOCGIFFLAGS, req))[1]
fcntl.ioctl(s, SIOCSIFFLAGS, struct.pack("16sH14s", b"lo", flags | IFF_UP, b""))
if len(sys.argv) > 1:
    os.execvp(sys.argv[1], sys.argv[1:])
