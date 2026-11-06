// Side effects driven by RoomView changes: sounds, haptics, title flash, pre-actions, vote toasts.
import { useEffect, useRef } from 'react';
import type { RoomView } from '../../shared/types';
import { voteOutcomeText, winningsByPlayer } from '../lib/describe';
import { amountToCall, myPlayer, nameResolver } from '../lib/gameState';
import { vibrate } from '../lib/haptics';
import { preActionStale, resolvePreAction } from '../lib/preActions';
import { sfx } from '../lib/sound';
import { flashTitle, setBaseTitle, stopTitleFlash } from '../lib/titleFlash';
import { actions } from '../net/actions';
import { setPreAction, toast, useStore } from '../state/store';

export function useGameEffects(room: RoomView): void {
  const prevRef = useRef<RoomView | null>(null);
  const seenPending = useRef<Set<string>>(new Set());
  const toasted = useRef<Set<string>>(new Set());

  useEffect(() => {
    setBaseTitle(`Flock Poker · ${room.roomId}`);
    return () => {
      stopTitleFlash();
      setBaseTitle('Flock Poker');
    };
  }, [room.roomId]);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = room;
    const me = myPlayer(room);
    const hand = room.hand;
    const prevHand = prev?.hand ?? null;
    const sameHand = !!hand && !!prevHand && hand.handNumber === prevHand.handNumber;

    // ---- my turn
    const turnStarted = !!room.me.legal && !prev?.me.legal;
    const turnEnded = !room.me.legal && !!prev?.me.legal;
    const pre = useStore.getState().preAction;
    if (turnStarted) {
      let auto = null;
      if (pre && hand && pre.handNumber === hand.handNumber && pre.street === hand.street) {
        auto = resolvePreAction(pre, room.me.legal!);
      }
      if (pre) setPreAction(null);
      if (auto) {
        const a = auto;
        setTimeout(() => void actions.act(a), 250);
      } else {
        sfx.turn();
        vibrate([40, 60, 40]);
        flashTitle('Your turn!');
      }
    } else if (pre) {
      const toCall = amountToCall(room, me);
      if (!hand || !me || !me.inHand || me.folded || me.allIn || preActionStale(pre, hand.handNumber, hand.street, toCall)) {
        setPreAction(null);
      }
    }
    if (turnEnded) stopTitleFlash();

    // ---- table sounds
    if (hand && (!prevHand || hand.handNumber !== prevHand.handNumber)) {
      if (prev) sfx.deal();
    } else if (sameHand) {
      if (hand!.board.length > prevHand!.board.length) sfx.flip();
      const prevBets = new Map(prev!.players.map((p) => [p.id, p.bet] as const));
      const chipsIn = room.players.some((p) => p.bet > (prevBets.get(p.id) ?? 0));
      if (chipsIn && hand!.street === prevHand!.street) sfx.chip();
      if (prevHand!.phase !== 'complete' && hand!.phase === 'complete') {
        const mine = winningsByPlayer(hand!.winners).get(room.me.playerId) ?? 0;
        if (mine > 0) {
          sfx.win(true);
          vibrate([30, 40, 90]);
        } else sfx.chip();
      }
    }

    // ---- buy-back votes
    const newForMe = room.me.votesAwaitingMe.filter((id) => !(prev?.me.votesAwaitingMe ?? []).includes(id));
    if (newForMe.length && prev) {
      sfx.alert();
      vibrate([60, 40, 60]);
    }
    const nameOf = nameResolver(room);
    for (const v of room.buyBackVotes) {
      if (v.status === 'pending') {
        seenPending.current.add(v.id);
        continue;
      }
      if (!seenPending.current.has(v.id) || toasted.current.has(v.id)) continue;
      toasted.current.add(v.id);
      const who = v.requesterId === room.me.playerId ? 'Your buy-back' : `${v.requesterName}’s buy-back`;
      const text = `${who}: ${voteOutcomeText(v, nameOf)}`;
      toast(v.status === 'approved' ? 'success' : 'info', text, 5000);
      if (v.status === 'approved' && v.requesterId === room.me.playerId) sfx.win(false);
    }

    // ---- seat approved
    const prevMe = prev ? myPlayer(prev) : undefined;
    if (prevMe && prevMe.seat === null && prevMe.pendingSeat !== null && me && me.seat !== null) {
      toast('success', `You’re in! Seat ${me.seat + 1}`);
    } else if (prevMe && prevMe.pendingSeat !== null && me && me.seat === null && me.pendingSeat === null) {
      toast('info', 'The host didn’t approve your seat this time');
    }

    // ---- game over
    if (prev && !prev.gameOverWinnerId && room.gameOverWinnerId) {
      if (room.gameOverWinnerId === room.me.playerId) sfx.win(true);
    }
  }, [room]);

  // chat pop sound
  const chatLen = useStore((s) => s.chat.length);
  const lastChat = useRef(chatLen);
  useEffect(() => {
    if (chatLen > lastChat.current) {
      const last = useStore.getState().chat[chatLen - 1];
      if (last && !last.system && last.playerId !== room.me.playerId) sfx.pop();
    }
    lastChat.current = chatLen;
  }, [chatLen, room.me.playerId]);
}
