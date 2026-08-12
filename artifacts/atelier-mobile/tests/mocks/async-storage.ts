// In-memory AsyncStorage mock for the push-fallback probe.
export const store = new Map<string, string>();
export default {
  async getItem(k: string) {
    return store.has(k) ? store.get(k)! : null;
  },
  async setItem(k: string, v: string) {
    store.set(k, v);
  },
  async removeItem(k: string) {
    store.delete(k);
  },
};
