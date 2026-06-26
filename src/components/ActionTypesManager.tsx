import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, addDoc, doc, updateDoc, deleteDoc, serverTimestamp, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Plus, Trash2, Edit2, Save, X, Activity, Info } from 'lucide-react';
import ConfirmModal from './ConfirmModal';

interface ActionType {
  id?: string;
  action: string;
  name: string;
  description: string;
  status: 'active' | 'inactive';
  createdAt: any;
}

export default function ActionTypesManager() {
  const [types, setTypes] = useState<ActionType[]>([]);
  const [editingType, setEditingType] = useState<ActionType | null>(null);
  const [isAddingType, setIsAddingType] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  const handleSeedTypes = async () => {
    if (types.length > 0) return;
    const initialTypes = [
      { action: 'NEW', name: 'Nuevo', description: 'Nueva solicitud o contacto', status: 'active' },
      { action: 'COR', name: 'Corrección', description: 'Corrección de datos o documentos', status: 'active' },
      { action: 'CAN', name: 'Cancelación', description: 'Cancelación de trámite o póliza', status: 'active' }
    ];

    try {
      for (const t of initialTypes) {
        await addDoc(collection(db, 'actionTypes'), {
          ...t,
          createdAt: serverTimestamp()
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'actionTypes');
    }
  };

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'actionTypes'), orderBy('action', 'asc')), (snap) => {
      const fetchedTypes = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ActionType));
      setTypes(fetchedTypes);
      setLoading(false);
      
      // Auto-seed if empty
      if (fetchedTypes.length === 0) {
        handleSeedTypes();
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'actionTypes');
      setLoading(false);
    });

    return () => unsub();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingType) return;

    try {
      if (editingType.id) {
        const { id, ...data } = editingType;
        await updateDoc(doc(db, 'actionTypes', id), data);
      } else {
        await addDoc(collection(db, 'actionTypes'), {
          ...editingType,
          createdAt: serverTimestamp()
        });
      }
      setEditingType(null);
      setIsAddingType(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'actionTypes');
    }
  };

  const handleDelete = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Eliminar Tipo de Acción',
      message: '¿Estás seguro de eliminar este tipo de acción?',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'actionTypes', id));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `actionTypes/${id}`);
        }
      }
    });
  };

  if (loading) return <div className="animate-pulse p-8">Cargando tipos de acción...</div>;

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-gray-900">Tipos de Acción</h3>
          <p className="text-gray-500 text-sm">Gestiona las categorías de acciones para el seguimiento de clientes</p>
        </div>
        <div className="flex gap-2">
          {types.length === 0 && (
            <button
              onClick={handleSeedTypes}
              className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
            >
              Cargar Iniciales
            </button>
          )}
          <button
            onClick={() => {
              setIsAddingType(true);
              setEditingType({ action: '', name: '', description: '', status: 'active', createdAt: null });
            }}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-all flex items-center gap-2 shadow-lg shadow-blue-200"
          >
            <Plus className="w-4 h-4" />
            Nuevo Tipo de Acción
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {types.map((type) => (
          <div key={type.id} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all group">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-50 text-blue-600 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-colors">
                  <Activity className="w-6 h-6" />
                </div>
                <span className="text-xs font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-lg">
                  {type.action}
                </span>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => setEditingType(type)}
                  className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(type.id!)}
                  className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            
            <h4 className="text-lg font-bold text-gray-900 mb-1">{type.name}</h4>
            <p className="text-sm text-gray-500 line-clamp-2 mb-4">{type.description}</p>
            
            <div className="flex items-center justify-between pt-4 border-t border-gray-50">
              <span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase ${
                type.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
              }`}>
                {type.status === 'active' ? 'Activo' : 'Inactivo'}
              </span>
            </div>
          </div>
        ))}

        {types.length === 0 && (
          <div className="col-span-full py-20 text-center bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200">
            <Activity className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 font-medium">No hay tipos de acción configurados.</p>
            <p className="text-sm text-gray-400 mt-1">Comienza agregando uno nuevo o cargando los iniciales.</p>
          </div>
        )}
      </div>

      {/* Editor Modal */}
      {editingType && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h3 className="text-xl font-bold text-gray-900">
                {isAddingType ? 'Nuevo Tipo de Acción' : 'Editar Tipo de Acción'}
              </h3>
              <button onClick={() => { setEditingType(null); setIsAddingType(false); }} className="p-2 hover:bg-white rounded-full transition-colors">
                <X className="w-6 h-6 text-gray-400" />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-8 space-y-6">
              <div>
                <label className="block text-xs font-black text-gray-400 uppercase mb-2 tracking-widest">Acción (Código)</label>
                <input
                  type="text"
                  required
                  placeholder="Ej: NEW"
                  value={editingType.action}
                  onChange={e => setEditingType({ ...editingType, action: e.target.value.toUpperCase() })}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-900"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-gray-400 uppercase mb-2 tracking-widest">Nombre del Tipo</label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Nuevo Registro"
                  value={editingType.name}
                  onChange={e => setEditingType({ ...editingType, name: e.target.value })}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-900"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-gray-400 uppercase mb-2 tracking-widest">Descripción</label>
                <textarea
                  required
                  rows={3}
                  placeholder="Describe brevemente esta acción..."
                  value={editingType.description}
                  onChange={e => setEditingType({ ...editingType, description: e.target.value })}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none resize-none text-gray-600"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-gray-400 uppercase mb-2 tracking-widest">Estado</label>
                <div className="flex gap-2">
                  {(['active', 'inactive'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setEditingType({ ...editingType, status: s })}
                      className={`flex-1 py-3 rounded-xl text-xs font-bold border transition-all ${
                        editingType.status === s
                          ? 'bg-blue-600 border-blue-600 text-white shadow-md'
                          : 'bg-white border-gray-200 text-gray-500 hover:border-blue-300'
                      }`}
                    >
                      {s === 'active' ? 'Activo' : 'Inactivo'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-4 flex gap-4">
                <button
                  type="button"
                  onClick={() => { setEditingType(null); setIsAddingType(false); }}
                  className="flex-1 px-6 py-4 border border-gray-200 text-gray-600 font-bold rounded-2xl hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-6 py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 shadow-xl shadow-blue-200 transition-all flex items-center justify-center gap-2"
                >
                  <Save className="w-5 h-5" />
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
      />
    </div>
  );
}
