// ctf-client/src/App.js
import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Game from './pages/Game';
import Instructions from './pages/Instructions';
import Results from './pages/Results'; // <-- NEW IMPORT
import './App.css';

function App() {
  return (
    <div className="App">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/game" element={<Game />} />
        <Route path="/instructions" element={<Instructions />} />
        <Route path="/results" element={<Results />} /> {/* <-- NEW ROUTE */}
      </Routes>
    </div>
  );
}

export default App;