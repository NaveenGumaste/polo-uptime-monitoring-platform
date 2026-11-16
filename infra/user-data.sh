#!/bin/bash
set -Eeuo pipefail

exec > >(tee -a /var/log/polo-bootstrap.log) 2>&1
trap 'echo "Bootstrap failed at line $LINENO" >&2' ERR

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y ca-certificates curl

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

. /etc/os-release

cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

apt-get update
apt-get install -y \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin

systemctl enable --now docker
usermod -aG docker ubuntu

if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
fi

if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  swapon /swapfile
fi

if ! grep -qE '^/swapfile[[:space:]]' /etc/fstab; then
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

printf 'vm.swappiness=10\n' > /etc/sysctl.d/99-polo.conf
sysctl -p /etc/sysctl.d/99-polo.conf

install -d -m 0750 -o ubuntu -g ubuntu /opt/polo
install -d -m 0755 /var/lib/polo

docker version
docker compose version
free -h

touch /var/lib/polo/bootstrap-complete
echo "Polo bootstrap completed"