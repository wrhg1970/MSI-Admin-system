import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, doc, updateDoc, deleteDoc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Subcategory, Category } from '../types';
import { Plus, Trash2, Edit2, Save, X, AlertCircle } from 'lucide-react';
import ConfirmModal from './ConfirmModal';

export default function SubcategoriesManager() {
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [editingSubcategory, setEditingSubcategory] = useState<Subcategory | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    id: string;
  }>({ isOpen: false, id: '' });

  useEffect(() => {
    const unsubCats = onSnapshot(query(collection(db, 'categories'), orderBy('name', 'asc')), (snap) => {
      setCategories(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category)));
    });

    const q = query(collection(db, 'subcategories'), orderBy('name', 'asc'));
    const unsubSubs = onSnapshot(q, (snap) => {
      setSubcategories(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Subcategory)));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'subcategories');
      setLoading(false);
    });

    return () => {
      unsubCats();
      unsubSubs();
    };
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSubcategory) return;

    try {
      if (editingSubcategory.id) {
        const { id, ...data } = editingSubcategory;
        await updateDoc(doc(db, 'subcategories', id), {
          ...data,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'subcategories'), {
          ...editingSubcategory,
          createdAt: serverTimestamp()
        });
      }
      setEditingSubcategory(null);
      setIsAdding(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'subcategories');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'subcategories', id));
      setConfirmModal({ isOpen: false, id: '' });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `subcategories/${id}`);
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Cargando subcategorías...</div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold text-gray-900">Subcategorías</h3>
        <button
          onClick={() => {
            setEditingSubcategory({ name: '', categoryId: '', description: '' });
            setIsAdding(true);
          }}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 transition-all flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Nueva Subcategoría
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="px-6 py-4 font-medium">Nombre</th>
              <th className="px-6 py-4 font-medium">Categoría</th>
              <th className="px-6 py-4 font-medium">Descripción</th>
              <th className="px-6 py-4 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {subcategories.map((sub) => {
              const category = categories.find(c => c.id === sub.categoryId);
              return (
                <tr key={sub.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 text-sm font-bold text-gray-900">{sub.name}</td>
                  <td className="px-6 py-4 text-sm">
                    <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded-lg text-xs font-bold">
                      {category?.name || '---'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{sub.description || '---'}</td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setEditingSubcategory(sub)}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setConfirmModal({ isOpen: true, id: sub.id! })}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {subcategories.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-12 text-center text-gray-400 italic">
                  No hay subcategorías registradas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editingSubcategory && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-gray-900">
                {isAdding ? 'Nueva Subcategoría' : 'Editar Subcategoría'}
              </h3>
              <button onClick={() => { setEditingSubcategory(null); setIsAdding(false); }}>
                <X className="w-6 h-6 text-gray-400 hover:text-gray-600" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Nombre</label>
                <input
                  type="text"
                  required
                  value={editingSubcategory.name}
                  onChange={e => setEditingSubcategory({ ...editingSubcategory, name: e.target.value })}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  placeholder="Nombre de la subcategoría"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Categoría Vinculada</label>
                <select
                  required
                  value={editingSubcategory.categoryId}
                  onChange={e => setEditingSubcategory({ ...editingSubcategory, categoryId: e.target.value })}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                >
                  <option value="">Seleccionar Categoría</option>
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Descripción</label>
                <textarea
                  value={editingSubcategory.description}
                  onChange={e => setEditingSubcategory({ ...editingSubcategory, description: e.target.value })}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm min-h-[100px]"
                  placeholder="Descripción opcional"
                />
              </div>
              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => { setEditingSubcategory(null); setIsAdding(false); }}
                  className="flex-1 px-4 py-3 border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2"
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
        onClose={() => setConfirmModal({ isOpen: false, id: '' })}
        onConfirm={() => handleDelete(confirmModal.id)}
        title="Eliminar Subcategoría"
        message="¿Estás seguro de eliminar esta subcategoría? Esta acción no se puede deshacer."
      />
    </div>
  );
}
