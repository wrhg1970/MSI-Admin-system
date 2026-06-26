import React from 'react';
import { X, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
}

export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Eliminar',
  cancelText = 'Cancelar',
  type = 'danger'
}: ConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
        >
          <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${
                type === 'danger' ? 'bg-red-50 text-red-600' : 
                type === 'warning' ? 'bg-orange-50 text-orange-600' : 
                'bg-blue-50 text-blue-600'
              }`}>
                <AlertCircle className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold text-gray-900">{title}</h3>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white rounded-full transition-colors">
              <X className="w-6 h-6 text-gray-400" />
            </button>
          </div>

          <div className="p-6">
            <p className="text-gray-600">{message}</p>
          </div>

          <div className="p-6 pt-0 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50 transition-colors"
            >
              {cancelText}
            </button>
            <button
              type="button"
              onClick={() => {
                onConfirm();
                onClose();
              }}
              className={`flex-1 px-4 py-2.5 text-white font-bold rounded-xl transition-all shadow-lg ${
                type === 'danger' ? 'bg-red-600 hover:bg-red-700 shadow-red-200' : 
                type === 'warning' ? 'bg-orange-600 hover:bg-orange-700 shadow-orange-200' : 
                'bg-blue-600 hover:bg-blue-700 shadow-blue-200'
              }`}
            >
              {confirmText}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
