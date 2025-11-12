import './App.css'
import { MapView } from './components/MapView';

function App() {


  return (
    <>
      <MapView 
      initialCenter={[12.228, 48.06]}
      initialZoom={13}/>
    </>
  )
}

export default App
