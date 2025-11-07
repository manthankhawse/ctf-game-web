// src/context/SocketContext.jsx
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const SocketContext = createContext();

// Custom hook to use the socket context
export const useSocket = () => useContext(SocketContext);

export const SocketProvider = ({ children }) => {
    const [socket, setSocket] = useState(null);
    const [clientId, setClientId] = useState(null);
    const [playerName, setPlayerName] = useState(localStorage.getItem('playerName') || '');
    const [lobbyState, setLobbyState] = useState(null); // <-- NEW: Lobby state
    
    const navigate = useNavigate();
    const messageListenersRef = useRef(new Map());

    useEffect(() => {
        const ws = new WebSocket('ws://localhost:3000');

        ws.onopen = () => {
            console.log('Global WebSocket connected');
            setSocket(ws);
        };

        ws.onclose = () => {
            console.log('Global WebSocket disconnected');
            setSocket(null);
            setLobbyState(null); // <-- Clear lobby on disconnect
            alert('Connection to server lost. Returning home.');
            navigate('/');
        };

        ws.onmessage = (event) => {
            const message = JSON.parse(event.data);

            // Give the message to all registered listeners
            messageListenersRef.current.forEach((listener, type) => {
                if (type === message.type || type === 'all') {
                    listener(message);
                }
            });

            // Handle global messages
            switch (message.type) {
                case 'server_client_id':
                    setClientId(message.clientId);
                    console.log('Got client ID:', message.clientId);
                    if (playerName) {
                        ws.send(JSON.stringify({ type: 'client_set_name', name: playerName }));
                    }
                    break;
                
                // --- NEW: Context now handles lobby state ---
                case 'server_lobby_created':
                case 'server_lobby_joined':
                case 'server_lobby_update':
                    console.log('Context updating lobby state:', message.lobbyState);
                    setLobbyState(message.lobbyState);
                    break;

                case 'server_game_starting':
                    console.log('Context saw game starting, navigating...');
                    // We set lobby state just in case, then navigate
                    setLobbyState(message.lobby); 
                    navigate('/game');
                    break;
                // ------------------------------------------

                case 'error':
                    console.error('Server error:', message.message);
                    alert(`Error: ${message.message}`);
                    break;
                default:
                    break;
            }
        };

        setSocket(ws);

        return () => {
            ws.close();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Runs only once

    const addSocketListener = (type, callback) => {
        messageListenersRef.current.set(type, callback);
    };

    const removeSocketListener = (type) => {
        messageListenersRef.current.delete(type);
    };

    const updatePlayerName = (name) => {
        const trimmedName = name.substring(0, 15);
        setPlayerName(trimmedName);
        localStorage.setItem('playerName', trimmedName);
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'client_set_name', name: trimmedName }));
        }
    };

    // NEW: Function to manually leave lobby
    const leaveLobby = () => {
        setLobbyState(null);
        navigate('/');
    };

    const value = {
        socket,
        clientId,
        playerName,
        lobbyState, // <-- Expose lobby state
        updatePlayerName,
        addSocketListener,
        removeSocketListener,
        leaveLobby, // <-- Expose leave function
    };

    return (
        <SocketContext.Provider value={value}>
            {children}
        </SocketContext.Provider>
    );
};