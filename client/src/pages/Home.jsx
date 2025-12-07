import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSocket } from '../context/SocketContext';
import '../App.css';

function Home() {
    const { socket, playerName, updatePlayerName, addSocketListener, removeSocketListener, lobbyState } = useSocket();
    const [lobbyCode, setLobbyCode] = useState('');
    const navigate = useNavigate();

    useEffect(() => {
        if (!socket) return;
        const handleLobbyUpdate = (message) => {
            navigate(`/lobby/${message.lobbyState.lobbyId}`);
        };
        addSocketListener('server_lobby_created', handleLobbyUpdate);
        addSocketListener('server_lobby_joined', handleLobbyUpdate);
        return () => {
            removeSocketListener('server_lobby_created');
            removeSocketListener('server_lobby_joined');
        };
    }, [socket, addSocketListener, removeSocketListener, navigate]);

    useEffect(() => {
        if (lobbyState) navigate(`/lobby/${lobbyState.lobbyId}`);
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
            <header>
                <h1>CYBER FLAG</h1>
                <p className="subtitle">TACTICAL MULTIPLAYER ARENA</p>
            </header>

            <div className="name-input-container">
                <input
                    type="text"
                    placeholder="ENTER CODENAME"
                    value={playerName}
                    onChange={(e) => updatePlayerName(e.target.value)}
                    maxLength="15"
                />
            </div>

            <div className="menu-section">
                <h2>PUBLIC MATCH</h2>
                <div className="button-group">
                    <button onClick={() => handleFindGame('1v1')}>1 VS 1</button>
                    <button onClick={() => handleFindGame('2v2')}>2 VS 2</button>
                    <button onClick={() => handleFindGame('3v3')}>3 VS 3</button>
                </div>
            </div>

            <div className="menu-section private-section">
                <h2>PRIVATE LOBBY</h2>
                <div className="button-group">
                    <button onClick={() => handleCreateLobby('1v1')}>CREATE 1v1</button>
                    <button onClick={() => handleCreateLobby('2v2')}>CREATE 2v2</button>
                    <button onClick={() => handleCreateLobby('3v3')}>CREATE 3v3</button>
                </div>
                
                <div style={{ marginTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1.5rem' }}>
                    <div className="join-lobby-container">
                        <input
                            type="text"
                            placeholder="CODE"
                            value={lobbyCode}
                            onChange={(e) => setLobbyCode(e.target.value)}
                            maxLength="6"
                        />
                        <button className="join-btn" onClick={handleJoinLobby}>JOIN</button>
                    </div>
                </div>
            </div>

            <Link to="/instructions" className="how-to-play-link">
                How to Play
            </Link>
        </div>
    );
}

export default Home;