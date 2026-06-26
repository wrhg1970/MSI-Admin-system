import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, addDoc, doc, updateDoc, deleteDoc, serverTimestamp, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Plus, Trash2, Edit2, Save, X, Shield, Info } from 'lucide-react';
import ConfirmModal from './ConfirmModal';

interface InsuranceType {
  id?: string;
  name: string;
  description: string;
  minAge: number;
  maxAge: number;
  status: 'active' | 'inactive';
  createdAt: any;
}

export default function InsuranceTypesManager() {
  const [types, setTypes] = useState<InsuranceType[]>([]);
  const [editingType, setEditingType] = useState<InsuranceType | null>(null);
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

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'insuranceTypes'), orderBy('minAge', 'asc')), (snap) => {
      setTypes(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsuranceType)));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'insuranceTypes');
      setLoading(false);
    });

    return () => unsub();
  }, []);

  const handleSeedTypes = async () => {
    if (types.length > 0) return;
    const initialTypes = [
      { name: 'U6', description: 'Seguro para menores de 6 años', minAge: 0, maxAge: 5, status: 'active' },
      { name: 'Student', description: 'Seguro para estudiantes internacionales (6-25 años)', minAge: 6, maxAge: 25, status: 'active' },
      { name: 'Traveler', description: 'Seguro para viajeros frecuentes (26-69 años)', minAge: 26, maxAge: 69, status: 'active' },
      { name: 'O70', description: 'Seguro para mayores de 70 años', minAge: 70, maxAge: 120, status: 'active' },
      { name: 'Xtreme', description: 'Seguro para deportes extremos (15-69 años)', minAge: 15, maxAge: 69, status: 'active' }
    ];

    try {
      for (const t of initialTypes) {
        await addDoc(collection(db, 'insuranceTypes'), {
          ...t,
          createdAt: serverTimestamp()
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'insuranceTypes');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingType) return;

    try {
      if (editingType.id) {
        const { id, ...data } = editingType;
        await updateDoc(doc(db, 'insuranceTypes', id), data);
      } else {
        await addDoc(collection(db, 'insuranceTypes'), {
          ...editingType,
          createdAt: serverTimestamp()
        });
      }
      setEditingType(null);
      setIsAddingType(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'insuranceTypes');
    }
  };

  const handleDelete = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Eliminar Tipo de Seguro',
      message: '¿Estás seguro de eliminar este tipo de seguro?',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'insuranceTypes', id));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `insuranceTypes/${id}`);
        }
      }
    });
  };

  if (loading) return <div className="animate-pulse p-8">Cargando tipos de seguro...</div>;

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-gray-900">Tipos de Seguro</h3>
          <p className="text-gray-500 text-sm">Gestiona las categorías de seguros disponibles</p>
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
              setEditingType({
                name: '',
                description: '',
                minAge: 0,
                maxAge: 120,
                status: 'active',
                createdAt: null
              });
            }}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-2 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Nuevo Tipo
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {types.map((type) => (
          <div key={type.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow group">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${
                    type.status === 'active' ? 'bg-blue-50 text-blue-600' : 'bg-gray-50 text-gray-400'
                  }`}>
                    <Shield className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-gray-900">{type.name}</h3>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase ${
                        type.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {type.status === 'active' ? 'Activo' : 'Inactivo'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => setEditingType(type)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleDelete(type.id!)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <p className="text-sm text-gray-600 line-clamp-2 mb-4">{type.description || 'Sin descripción'}</p>
              
              <div className="flex items-center gap-4 pt-4 border-t border-gray-50">
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <Info className="w-3.5 h-3.5" />
                  <span>Categoría de Seguro</span>
                </div>
              </div>
            </div>
          </div>
        ))}

        {types.length === 0 && (
          <div className="col-span-full py-12 text-center bg-white rounded-xl border-2 border-dashed border-gray-100">
            <Shield className="w-12 h-12 text-gray-200 mx-auto mb-4" />
            <p className="text-gray-400 font-medium">No hay tipos de seguro configurados</p>
            <button
              onClick={() => setIsAddingType(true)}
              className="mt-4 text-blue-600 font-bold text-sm hover:underline"
            >
              Crear el primer tipo
            </button>
          </div>
        )}
      </div>

      {/* Editor Modal */}
      {(editingType || isAddingType) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h3 className="text-xl font-bold text-gray-900">
                {editingType?.id ? 'Editar Tipo de Seguro' : 'Nuevo Tipo de Seguro'}
              </h3>
              <button onClick={() => { setEditingType(null); setIsAddingType(false); }} className="p-2 hover:bg-white rounded-full transition-colors">
                <X className="w-6 h-6 text-gray-400" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nombre del Tipo</label>
                <input
                  type="text"
                  required
                  value={editingType?.name || ''}
                  onChange={e => setEditingType({ ...editingType!, name: e.target.value })}
                  className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="Ej: U6, O70, Student..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Edad Mínima</label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={editingType?.minAge ?? 0}
                    onChange={e => setEditingType({ ...editingType!, minAge: parseInt(e.target.value) })}
                    className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Edad Máxima</label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={editingType?.maxAge ?? 120}
                    onChange={e => setEditingType({ ...editingType!, maxAge: parseInt(e.target.value) })}
                    className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Estado</label>
                <select
                  value={editingType?.status || 'active'}
                  onChange={e => setEditingType({ ...editingType!, status: e.target.value as any })}
                  className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="active">Activo</option>
                  <option value="inactive">Inactivo</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Descripción</label>
                <textarea
                  value={editingType?.description || ''}
                  onChange={e => setEditingType({ ...editingType!, description: e.target.value })}
                  className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none h-24 resize-none"
                  placeholder="Describe brevemente este tipo de seguro..."
                />
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => { setEditingType(null); setIsAddingType(false); }}
                  className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" />
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
