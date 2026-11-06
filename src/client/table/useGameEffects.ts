// Side effects driven by RoomView changes: sounds, haptics, title flash and pre-actions.
// (Seat approvals and buy-back results arrive as server notices -> toasts.)
import { useEffect, useRef } from 'react';
import type { RoomView } from '../../shared/types';
import { winningsByPlayer } from '../lib/describe';
import { amountToCall, myPlayer } from '../lib/gameState';
import { vibrate } from '../lib/haptics';
import { preActionApplies, preActionStale, resolvePreAction } from '../lib/preActions';
import { sfx } from '../lib/sound';
import { flashTitle, setBaseTitle, stopTitleFlash } from '../lib/titleFlash';
import { actions } from '../net/actions';
import { setPreAction, setUI, useStore } from '../state/store';

export function useGameEffects(room: RoomView): void {
  const prevRef = useRef<RoomView | null>(null);
  const seenPending = useRef<Set<string>>(new Set());
  const resolvedSeen = useRef<Set<string>>(new Set());

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
      if (pre && hand && preActionApplies(pre, hand.handNumber, hand.street)) {
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
      } else if (pre.nextStreet && pre.street !== hand.street) {
        // the street it was armed for has arrived: from now on it is an ordinary toggle for it
        setPreAction({ ...pre, street: hand.street, nextStreet: false });
      }
    }
    if (turnEnded) {
      stopTitleFlash();
      if (useStore.getState().ui.raiseOpen) setUI({ raiseOpen: false });
    }

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
      flashTitle('Buy-back vote!');
    }
    if (newForMe.length) {
      // silence counts as "no": make sure the vote modal is not hidden behind a sheet
      const ui = useStore.getState().ui;
      if (ui.menuOpen || ui.inviteOpen) setUI({ menuOpen: false, inviteOpen: false });
    } else if (!room.me.votesAwaitingMe.length && prev?.me.votesAwaitingMe.length && !room.me.legal) {
      stopTitleFlash();
    }
    // Resolved votes are shown by the floating result card (others) and the busted panel (requester);
    // the requester also gets a server notice. Only add a sound for my own approval.
    for (const v of room.buyBackVotes) {
      if (v.status === 'pending') {
        seenPending.current.add(v.id);
        continue;
      }
      if (!seenPending.current.has(v.id) || resolvedSeen.current.has(v.id)) continue;
      resolvedSeen.current.add(v.id);
      if (v.status === 'approved' && v.requesterId === room.me.playerId) sfx.win(false);
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
