import React, { useState, useEffect } from 'react';
import { X, Calendar, User, AlertCircle, Clock } from 'lucide-react';
import { Task, UserProfile } from '../types';
import { format } from 'date-fns';

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (task: Partial<Task>) => void;
  editingTask: Task | null;
  users: UserProfile[];
  currentUser: UserProfile | null;
}

export default function TaskModal({ isOpen, onClose, onSave, editingTask, users, currentUser }: TaskModalProps) {
  const [formData, setFormData] = useState<Partial<Task>>({
    title: '',
    description: '',
    dueDate: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    status: 'pending',
    priority: 'medium',
    assignedTo: '',
    createdBy: currentUser?.uid || '',
  });

  useEffect(() => {
    if (editingTask) {
      setFormData({
        ...editingTask,
        dueDate: editingTask.dueDate?.toDate 
          ? format(editingTask.dueDate.toDate(), "yyyy-MM-dd'T'HH:mm")
          : editingTask.dueDate ? format(new Date(editingTask.dueDate), "yyyy-MM-dd'T'HH:mm") : '',
      });
    } else {
      setFormData({
        title: '',
        description: '',
        dueDate: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
        status: 'pending',
        priority: 'medium',
        assignedTo: currentUser?.uid || currentUser?.email || '',
        createdBy: currentUser?.uid || '',
      });
    }
  }, [editingTask, isOpen, currentUser]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] w-full max-w-lg overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
        <div className="p-8 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div>
            <h2 className="text-2xl font-black text-gray-900 uppercase tracking-tight">
              {editingTask ? 'Editar Tarea' : 'Nueva Tarea'}
            </h2>
            <p className="text-xs font-bold text-blue-600 uppercase tracking-widest mt-1">
              Organización de Agenda
            </p>
          </div>
          <button onClick={onClose} className="p-3 hover:bg-white rounded-2xl transition-all shadow-sm">
            <X className="w-6 h-6 text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-4">Título de la Tarea</label>
            <input
              required
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Ej. Revisión de póliza..."
              className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-sm transition-all"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-4">Descripción (Opcional)</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Detalles adicionales..."
              rows={3}
              className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-sm transition-all resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-4 flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Fecha y Hora
              </label>
              <input
                type="datetime-local"
                value={formData.dueDate}
                onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-sm transition-all"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-4 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Prioridad
              </label>
              <select
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value as any })}
                className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-sm transition-all"
              >
                <option value="low">Baja</option>
                <option value="medium">Media</option>
                <option value="high">Alta</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-4 flex items-center gap-1">
              <User className="w-3 h-3" /> Asignar a
            </label>
            <select
              value={formData.assignedTo}
              onChange={(e) => setFormData({ ...formData, assignedTo: e.target.value })}
              className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-sm transition-all"
            >
              <option value="">Seleccionar Usuario</option>
              {users.map(u => (
                <option key={u.uid} value={u.uid || u.email}>{u.displayName || u.email}</option>
              ))}
            </select>
          </div>

          <div className="pt-4 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-4 bg-gray-100 text-gray-500 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-gray-200 transition-all"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 px-6 py-4 bg-[#1e40af] text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg shadow-blue-200"
            >
              {editingTask ? 'Actualizar' : 'Guardar Tarea'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
