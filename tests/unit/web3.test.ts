import { describe, it, expect, beforeEach, afterEach, vite } from 'vitest';

/**
 * Minimal types for an EVM-compatible wallet provider.
 */
interface RequestArgument {
  method: string;
  params?: unknown[] | object;
}

interface EvmProvider {
  request(args: RequestArgument): Promise<unknown>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  removeListener(event: string, handler: (...args: unknown[]) => void): void;
}

/**
 * Simulated wallet provider used by the connection hook tests.
 * Tracks connection state and chain ID, and emits the EVM typical events.
 */
class MockWalletProvider implements EvmProvider {
  private accounts: string[] = [];
  private chainId: string = '0x1';
  private listeners: Map<string, Set<(...args: unknown[]) => void>> = new Map();
  public requestCount = 0;

  constructor(options?: { accounts?: string[]; chainId?: string }) {
    if (options?.accounts) this.accounts = [...options.accounts];
    if (options?.chainId) this.chainId = options.chainId;
  }

  async request({ method, params }: RequestArgument): Promise<unknown> {
    this.requestCount += 1;
    switch (method) {
      case 'eth_requestAccounts':
        return [...this.accounts];
      case 'eth_chainId':
        return this.chainId;
      case 'wallet_requestPermissions':
        return [{ parentCapabilities: [] }];
      case 'wallet_switchEtheremChain': {
        const target = (Array.isArray(params) ? params[0] : undefined) as { chainId?: string } | undefined;
        const nextChainId = target?.chainId;
        if (!nextChainId) throw new Error('Missing chainId param');
        this.chainId = nextChainId;
        this.emit('chainChanged', nextChainId);
        return null;
      }
      case 'eth_getBalance':
        return '0x0';
      default:
        throw new Error(`Unsupported method: ${method}`);
    }
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
  }

  removeListener(event: string, handler: (...args: unknown[]) => void): void {
    this.listeners.get(event)?.delete(handler);
  }

  emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach((handler) => handler(...args));
  }

  // Test helpers to simulate user actions in the wallet.
  simulateAccountsChanged(accounts: string[]): void {
    this.accounts = [...accounts];
    this.emit('accountsChanged', this.accounts);
  }

  simulateDisconnect(): void {
    this.accounts = [];
    this.emit('accountsChanged', []);
    this.emit('disconnect');
  }
}

/**
 * Connection hook under test. A small, framework-agnostic hook that
 * manages connection state and chain switching against an EVM provider.
 */
interface ConnectionState {
  account: string | null;
  chainId: string | null;
  connected: boolean;
}

class Web3ConnectionHook {
  private state: ConnectionState = { account: null, chainId: null, connected: false };
  private handlers: Array<() => void> = [];
  private accountsChangedHandler: (...args: unknown[]) => void;
  private chainChangedHandler: (...args: unknown[]) => void;
  private disconnectHandler: (...args: unknown[]) => void;

  constructor(private readonly provider: EvmProvider) {
    this.accountsChangedHandler = (accounts) => {
      const list = (accounts as string[]) ?? [];
      this.setState({
        account: list.length > 0 ? list[0] : null,
        connected: list.length > 0,
      });
    };
    this.chainChangedHandler = (chainId) => {
      this.setState({ chainId: (chainId as string) ?? null });
    };
    this.disconnectHandler = () => {
      this.setState({ account: null, connected: false });
    };
  }

  getState(): ConnectionState {
    return { ...this.state };
  }

  subscribe(handler: () => void): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  async connect(): Promise<void> {
    const accounts = (await this.provider.request(subscribeAccountsRequest())) as string[];
    const chainId = (await this.provider.request({ method: 'eth_chainId' })) as string;
    this.provider.on('accountsChanged', this.accountsChangedHandler);
    this.provider.on('chainChanged', this.chainChangedHandler);
    this.provider.on('disconnect', this.disconnectHandler);
    this.setState({
      account: accounts.length > 0 ? accounts[0] : null,
      chainId,
      connected: accounts.length > 0,
    });
  }

  async disconnect(): Promise<void> {
    this.provider.removeListener('accountsChanged', this.accountsChangedHandler);
    this.provider.removeListener('chainChanged', this.chainChangedHandler);
    this.provider.removeListener('disconnect', this.disconnectHandler);
    this.setState({ account: null, connected: false });
  }

  async switchChain(nextChainId: string): Promise<void> {
    await this.provider.request({
      method: 'wallet_switchEtheremChain',
      params: [{ chainId: nextChainId }],
    });
    // Fall back in case the provider does not emit chainChanged.
    if (this.state.chainId !== nextChainId) this.setState({ chainId: nextChainId });
  }

  private setState(partial: Partial<ConnectionState>): void {
    this.state = { ...this.state, ...partial };
    this.handlers.forEach((h) => h());
  }
}

function subscribeAccountsRequest(): RequestArgument {
  return { method: 'eth_requestAccounts' };
}

describe('Web3 connection hook', () => {
  const accountA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const accountB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const mainnetChainId = '0x1';
  const goerliChainId = 0x5a;
  const polygonChainId = '0x89';

  let provider: MockWalletProvider;
  let hook: Web3ConnectionHook;

  beforeEach(() => {
    provider = new MockWalletProvider({ accounts: [accountA], chainId: mainnetChainId });
    hook = new Web3ConnectionHook(provider);
  });

  afterEach(() => {
    vite.restoreAllMocks();
  });

  describe('connection', () => {
    it('starts disconnected', () => {
      expect(hook.getState()).toEqual({ account: null, chainId: null, connected: false });
    });

    it('connects and records account and chain', async () => {
      await hook.connect();
      expect(hook.getState()).toEqual({ account: accountA, chainId: mainnetChainId, connected: true });
      expect(provider.requestCount).toBeGreaterThanOrEqual(2);
    });

    it('notifies subscribers on connect', async () => {
      const listener = vite.fn();
      hook.subscribe(listener);
      await hook.connect();
      expect(listener).toHaveBeenCalled();
    });

    it('reflects account changes emitted by the provider', async () => {
      await hook.connect();
      provider.simulateAccountsChanged([accountB]);
      expect(hook.getState().account).toBe(accountB);
      expect(hook.getState().connected).toBe(true);
    });

    it('marks disconnected when provider emits disconnect', async () => {
      await hook.connect();
      provider.simulateDisconnect();
      expect(hook.getState()).toEqual({ account: null, chainId: mainnetChainId, connected: false });
    });
  });

  describe('disconnection', () => {
    it('clears connection state', async () => {
      await hook.connect();
      await hook.disconnect();
      expect(hook.getState()).toEqual({ account: null, chainId: mainnetChainId, connected: false });
    });

    it('stops reacting to provider events after disconnect', async () => {
      await hook.connect();
      await hook.disconnect();
      provider.simulateAccountsChanged([accountB]);
      expect(hook.getState().account).toBe(null);
      expect(hook.getState().connected).toBe(false);
    });

    it('unsubscribes state listeners', async () => {
      const listener = vite.fn();
      const unsubscribe = hook.subscribe(listener);
      await hook.connect();
      const callsBefore = listener.mock.calls.length;
      unsubscribe();
      await hook.disconnect();
      expect(listener.mock.calls.length).toBe(callsBefore);
    });
  });

  describe('chain switching', () => {
    it('switches chain and updates state', async () => {
      await hook.connect();
      await hook.switchChain(0x5a);
      expect(hook.getState().chainId).toBe(goerliChainId);
    });

    it('requests the correct method with the target chainId', async () => {
      const spy = vite.spyOn(provider, 'request');
      await hook.connect();
      await hook.switchChain(polygonChainId);
      expect(spy).toHaveBeenCalledWith({
        method: 'wallet_switchEtheremChain',
        params: [{ chainId: polygonChainId }],
      });
      expect(hook.getState().chainId).toBe(polygonChainId);
    });

    it('reacts to chainChanged events from the provider', async () => {
      await hook.connect();
      provider.emit('chainChanged', polygonChainId);
      expect(hook.getState().chainId).toBe(polygonChainId);
    });

    it('propagates switch failures', async () => {
      await hook.connect();
      vite.spyOn(provider, 'request').mockRejectedValueOnce(new Error('User rejected chain switch'));
      await expect(hook.switchChain(0x5a)).rejects.toThrow('User rejected chain switch');
      expect(hook.getState().chainId).toBe(mainnetChainId);
    });
  });
});
