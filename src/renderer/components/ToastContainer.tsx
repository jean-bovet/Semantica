import React from 'react';
import Toast, { ToastMessage } from './Toast';

interface ToastContainerProps {
  messages: ToastMessage[];
  onClose: (id: string) => void;
}

const ToastContainer: React.FC<ToastContainerProps> = ({ messages, onClose }) => {
  return (
    <div className="fixed top-4 right-4 z-50 space-y-2">
      {messages.map((message) => (
        <Toast key={message.id} message={message} onClose={onClose} />
      ))}
    </div>
  );
};

export default ToastContainer;