// Thin wrappers around emitAck that surface errors as toasts.
import type { GameSettings, PlayerAction } from '../../shared/types';
import { toast } from '../state/store';
import { emitAck, type AckDataOf, type EventName, type PayloadOf } from './socket';
import type { AckResponse } from '../../shared/protocol';

async function run<E extends EventName>(event: E, payload: PayloadOf<E>, success?: string): Promise<AckResponse<AckDataOf<E>>> {
  const res = await emitAck(event, payload);
  if (!res.ok) toast('error', res.error);
  else if (success) toast('success', success);
  return res;
}

export const actions = {
  act: (a: PlayerAction) => run('game:action', a),
  showCards: () => run('game:showCards', {}),
  takeSeat: async (seat: number) => {
    const res = await run('seat:take', { seat });
    if (res.ok && res.data.pending) toast('info', 'Asked the host for a seat');
    return res;
  },
  standUp: () => run('seat:leave', {}),
  sitOut: (sittingOut: boolean) => run('player:sitOut', { sittingOut }),
  rename: (name: string) => run('player:rename', { name }, 'Name updated'),
  requestBuyBack: () => run('buyback:request', {}),
  voteBuyBack: (voteId: string, approve: boolean) => run('buyback:vote', { voteId, approve }),
  cancelBuyBack: (voteId: string) => run('buyback:cancel', { voteId }),
  sendChat: (text: string) => run('chat:send', { text }),
  start: () => run('host:start', {}),
  pause: () => run('host:pause', {}),
  resume: () => run('host:resume', {}),
  updateSettings: (p: Partial<GameSettings>) => run('host:updateSettings', p, 'Settings saved'),
  approveSeat: (playerId: string, approve: boolean) => run('host:approveSeat', { playerId, approve }),
  kick: (playerId: string) => run('host:kick', { playerId }),
  transfer: (playerId: string) => run('host:transfer', { playerId }),
  rematch: () => run('host:rematch', {}),
};
