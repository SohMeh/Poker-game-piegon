// ?mock=<scenario> — render fixture RoomViews without a server (visual QA).
import type { AckResponse } from '../../shared/protocol';
import { setMockTransport, type EventName } from '../net/socket';
import { toast, useStore } from '../state/store';
import { SCENARIO_NAMES, scenarioState } from './fixtures';

function ackData(event: EventName): unknown {
  switch (event) {
    case 'room:create':
      return { roomId: 'PIP42X', token: 'mock-token', playerId: 'p0' };
    case 'room:join':
      return { token: 'mock-token', playerId: 'p0' };
    case 'seat:take':
      return { pending: false };
    case 'buyback:request':
      return { voteId: 'mock-vote' };
    default:
      return {};
  }
}

export function installMock(name: string): void {
  setMockTransport(async (event, payload): Promise<AckResponse<unknown>> => {
    console.info('[mock]', event, payload);
    if (event === 'game:action' || event === 'buyback:vote') toast('info', `Mock: ${event}`);
    return { ok: true, data: ackData(event) };
  });
  const state = scenarioState(name, Date.now());
  useStore.setState({ mock: name, conn: 'connected', everConnected: true, ...state });
  (window as unknown as { __flockMockScenarios?: string[] }).__flockMockScenarios = SCENARIO_NAMES;
}
