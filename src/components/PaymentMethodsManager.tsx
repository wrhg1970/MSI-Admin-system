import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, addDoc, doc, updateDoc, deleteDoc, serverTimestamp, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Plus, Trash2, Edit2, Save, X, CreditCard, Info } from 'lucide-react';
import ConfirmModal from './ConfirmModal';

interface PaymentMethod {
  id?: string;
  name: string;
  status: 'active' | 'inactive';
  createdAt: any;
}

export default function PaymentMethodsManager() {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [editingMethod, setEditingMethod] = useState<PaymentMethod | null>(null);
  const [isAddingMethod, setIsAddingMethod] = useState(false);
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
    const unsub = onSnapshot(query(collection(db, 'paymentMethods'), orderBy('name', 'asc')), (snap) => {
      setMethods(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as PaymentMethod)));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'paymentMethods');
      setLoading(false);
    });

    return () => unsub();
  }, []);

  const handleSeedMethods = async () => {
    if (methods.length > 0) return;
    const initialMethods = [
      { name: 'Efectivo', status: 'active' },
      { name: 'Cancelado', status: 'active' },
      { name: 'Deposito MXP', status: 'active' },
      { name: 'Deposito USD', status: 'active' },
      { name: 'Tarjeta AMEX', status: 'active' },
      { name: 'Tarjeta VISA/MC', status: 'active' },
      { name: 'Sin Cobro', status: 'active' },
      { name: 'USD', status: 'active' }
    ];

    try {
      for (const m of initialMethods) {
        await addDoc(collection(db, 'paymentMethods'), {
          ...m,
          createdAt: serverTimestamp()
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'paymentMethods');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMethod) return;

    try {
      if (editingMethod.id) {
        const { id, ...data } = editingMethod;
        await updateDoc(doc(db, 'paymentMethods', id), data);
      } else {
        await addDoc(collection(db, 'paymentMethods'), {
          ...editingMethod,
          createdAt: serverTimestamp()
        });
      }
      setEditingMethod(null);
      setIsAddingMethod(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'paymentMethods');
    }
  };

  const handleDelete = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Eliminar Método de Pago',
      message: '¿Estás seguro de eliminar este método de pago?',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'paymentMethods', id));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `paymentMethods/${id}`);
        }
      }
    });
  };

  if (loading) return <div className="animate-pulse p-8 text-sm text-gray-500">Cargando métodos de pago...</div>;

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-gray-900">Métodos de Pago</h3>
          <p className="text-gray-500 text-sm">Gestiona las opciones de pago disponibles en el sistema</p>
        </div>
        <div className="flex gap-2">
          {methods.length === 0 && (
            <button
              onClick={handleSeedMethods}
              className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
            >
              Cargar Iniciales
            </button>
          )}
          <button
            onClick={() => {
              setIsAddingMethod(true);
              setEditingMethod({
                name: '',
                status: 'active',
                createdAt: null
              });
            }}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-2 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Nuevo Método
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {methods.map((method) => (
          <div key={method.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow group">
            <div className="p-4">
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${
                    method.status === 'active' ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-50 text-gray-400'
                  }`}>
                    <CreditCard className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-900 text-sm">{method.name}</h4>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase ${
                      method.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {method.status === 'active' ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => setEditingMethod(method)} className="p-1 px-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(method.id!)} className="p-1 px-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}

        {methods.length === 0 && (
          <div className="col-span-full py-12 text-center bg-white rounded-xl border-2 border-dashed border-gray-100">
            <CreditCard className="w-12 h-12 text-gray-200 mx-auto mb-4" />
            <p className="text-gray-400 font-medium">No hay métodos de pago configurados</p>
            <button
              onClick={() => setIsAddingMethod(true)}
              className="mt-4 text-blue-600 font-bold text-sm hover:underline"
            >
              Crear el primer método
            </button>
          </div>
        )}
      </div>

      {/* Editor Modal */}
      {(editingMethod || isAddingMethod) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h3 className="text-xl font-bold text-gray-900">
                {editingMethod?.id ? 'Editar Método de Pago' : 'Nuevo Método de Pago'}
              </h3>
              <button onClick={() => { setEditingMethod(null); setIsAddingMethod(false); }} className="p-2 hover:bg-white rounded-full transition-colors">
                <X className="w-6 h-6 text-gray-400" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nombre del Método</label>
                <input
                  type="text"
                  required
                  value={editingMethod?.name || ''}
                  onChange={e => setEditingMethod({ ...editingMethod!, name: e.target.value })}
                  className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="Ej: Transferencia, Efectivo, Zelle..."
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Estado</label>
                <select
                  value={editingMethod?.status || 'active'}
                  onChange={e => setEditingMethod({ ...editingMethod!, status: e.target.value as any })}
                  className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="active">Activo</option>
                  <option value="inactive">Inactivo</option>
                </select>
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => { setEditingMethod(null); setIsAddingMethod(false); }}
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
