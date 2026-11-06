import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../shared/types';
import { pushChat, resetRoomState, setHistory, useStore } from './store';

const msg = (id: string, playerId = 'p2'): ChatMessage => ({ id, playerId, name: 'Bob', text: id, ts: 1, system: false });

beforeEach(() => resetRoomState());

describe('chat history', () => {
  it('messages from a previously attached room do not count as unread after joining another room', () => {
    pushChat(msg('old-1'));
    pushChat(msg('old-2'));
    expect(useStore.getState().unreadChat).toBe(2);
    expect(useStore.getState().chatPops.map((m) => m.id)).toEqual(['old-1', 'old-2']);
    setHistory([msg('new-1')], []);
    expect(useStore.getState().unreadChat).toBe(0);
    expect(useStore.getState().chatPops).toEqual([]);
    expect(useStore.getState().chat.map((m) => m.id)).toEqual(['new-1']);
  });

  it('re-joining the same room (phone wakes up) keeps the unread count', () => {
    pushChat(msg('a'));
    pushChat(msg('b'));
    setHistory([msg('a'), msg('b')], []);
    expect(useStore.getState().unreadChat).toBe(2);
  });
});
