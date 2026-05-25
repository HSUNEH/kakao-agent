export class FakeKeychain {
  #items = new Map();

  async read(service, account) {
    return this.#items.get(key(service, account)) ?? null;
  }

  async write(service, account, secret) {
    this.#items.set(key(service, account), String(secret));
    return { service, account, stored: true };
  }

  async delete(service, account) {
    return this.#items.delete(key(service, account));
  }

  async status(service, account) {
    return {
      service,
      account,
      available: true,
      stored: this.#items.has(key(service, account))
    };
  }
}

function key(service, account) {
  return `${service}:${account}`;
}
