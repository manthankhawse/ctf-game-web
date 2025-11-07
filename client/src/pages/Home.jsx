// src/pages/Home.jsx
import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSocket } from '../context/SocketContext';
import '../App.css';

function Home() {
    const { socket, playerName, updatePlayerName, addSocketListener, removeSocketListener, lobbyState } = useSocket();
    const [lobbyCode, setLobbyCode] = useState('');
    const navigate = useNavigate();

    // Listen for lobby creation/join events
    useEffect(() => {
        if (!socket) return;

        // The context now handles navigation, but we can listen
        // to lobby updates to know when to navigate *away* from home.
        const handleLobbyUpdate = (message) => {
            console.log('Home page saw lobby update, navigating...');
            navigate(`/lobby/${message.lobbyState.lobbyId}`);
        };

        addSocketListener('server_lobby_created', handleLobbyUpdate);
        addSocketListener('server_lobby_joined', handleLobbyUpdate);

        return () => {
            removeSocketListener('server_lobby_created');
            removeSocketListener('server_lobby_joined');
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [socket, addSocketListener, removeSocketListener, navigate]);

    // If we refresh the page and are still in a lobby, go there
    useEffect(() => {
        if (lobbyState) {
            navigate(`/lobby/${lobbyState.lobbyId}`);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lobbyState, navigate]);

    const handleFindGame = (mode) => {
        if (!playerName) return alert('Please enter your name first.');
        socket.send(JSON.stringify({ type: 'client_find_game', mode }));
    };

    const handleCreateLobby = (mode) => {
        if (!playerName) return alert('Please enter your name first.');
        socket.send(JSON.stringify({ type: 'client_create_lobby', mode, isPrivate: true }));
    };

    const handleJoinLobby = () => {
        if (!playerName) return alert('Please enter your name first.');
        if (!lobbyCode) return alert('Please enter a lobby code.');
        socket.send(JSON.stringify({ type: 'client_join_lobby', lobbyId: lobbyCode.toUpperCase() }));
    };

    return (
        <div className="home-container">
            <h1>Capture the Flag</h1>
            <p>A fast-paced WebRTC game.</p>

            <div className="name-input-container">
                <input
                    type="text"
                    placeholder="Enter Your Name"
                    value={playerName}
                    onChange={(e) => updatePlayerName(e.target.value)}
                    maxLength="15"
                />
            </div>

            <h2>Find a Public Game</h2>
            <div className="button-group">
                <button onClick={() => handleFindGame('1v1')}>Find 1v1 Game</button>
                <button onClick={() => handleFindGame('2v2')}>Find 2v2 Game</button>
                <button onClick={() => handleFindGame('3v3')}>Find 3v3 Game</button>
            </div>

            <h2>Private Game</h2>
            <div className="button-group">
                <button onClick={() => handleCreateLobby('1v1')}>Create 1v1</button>
                <button onClick={() => handleCreateLobby('2v2')}>Create 2v2</button>
                <button onClick={() => handleCreateLobby('3v3')}>Create 3v3</button>
            </div>
            
            <div className="join-lobby-container">
                <input
                    type="text"
                    placeholder="Enter Lobby Code"
                    value={lobbyCode}
                    onChange={(e) => setLobbyCode(e.target.value)}
                    maxLength="6"
                />
                <button onClick={handleJoinLobby}>Join</button>
            </div>

            <Link to="/instructions">
                <button className="how-to-play-btn">How to Play</button>
            </Link>
        </div>
    );
}

export default Home;