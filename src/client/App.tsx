import { ReconnectBanner, Toasts } from './components/Toasts';
import { Home } from './screens/Home';
import { ErrorScreen, JoinScreen, KickedScreen, LoadingScreen, NotFoundScreen } from './screens/RoomGate';
import { useStore } from './state/store';
import { TableScreen } from './table/TableScreen';

function Screen() {
  const route = useStore((s) => s.route);
  const phase = useStore((s) => s.phase);
  const room = useStore((s) => s.room);
  if (route.name === 'home') return <Home />;
  if (room && room.roomId === route.roomId && phase === 'joined') return <TableScreen room={room} />;
  switch (phase) {
    case 'needsName':
    case 'joining':
      return <JoinScreen roomId={route.roomId} />;
    case 'notFound':
      return <NotFoundScreen />;
    case 'kicked':
      return <KickedScreen />;
    case 'error':
      return <ErrorScreen />;
    default:
      return <LoadingScreen />;
  }
}

export function App() {
  return (
    <>
      <Screen />
      <Toasts />
      <ReconnectBanner />
    </>
  );
}
