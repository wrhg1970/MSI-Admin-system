import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, doc, updateDoc, addDoc, deleteDoc, serverTimestamp, orderBy, where, getDocs } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { UserProfile, UserRole, CustomRole, Permission } from '../types';
import { Plus, Trash2, Edit2, Shield, User, Mail, Calendar, CheckCircle2, X, Save, Lock, Key, ChevronLeft, ChevronRight } from 'lucide-react';
import ConfirmModal from './ConfirmModal';

const SYSTEM_ROLES: { id: UserRole; name: string; description: string }[] = [
  { id: 'super_admin', name: 'Super Administrador', description: 'Acceso total al sistema y configuración' },
  { id: 'director', name: 'Director', description: 'Gestión estratégica y reportes' },
  { id: 'seguros', name: 'Seguros', description: 'Operación de pólizas y siniestros' },
  { id: 'administracion', name: 'Administración', description: 'Gestión de clientes y pagos' },
  { id: 'agent', name: 'Agente', description: 'Venta de seguros y gestión de cartera' },
  { id: 'client', name: 'Cliente', description: 'Acceso a sus propias pólizas' },
];

export default function UserManager() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editingRole, setEditingRole] = useState<CustomRole | null>(null);
  const [activeTab, setActiveTab] = useState<'users' | 'roles'>('users');
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [isAddingRole, setIsAddingRole] = useState(false);
  const [newUser, setNewUser] = useState({ 
    email: '', 
    role: 'agent' as UserRole | string, 
    commission: 0,
    canCreatePolicies: true,
    taxId: '',
    bankName: '',
    bankAccount: '',
    clabe: ''
  });
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
    const unsubUsers = onSnapshot(query(collection(db, 'users'), orderBy('createdAt', 'desc')), (snap) => {
      setUsers(snap.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'users');
    });

    const unsubRoles = onSnapshot(query(collection(db, 'roles'), orderBy('createdAt', 'desc')), (snap) => {
      setCustomRoles(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as CustomRole)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'roles');
    });

    const unsubPerms = onSnapshot(collection(db, 'permissions'), (snap) => {
      setPermissions(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Permission)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'permissions');
    });

    return () => {
      unsubUsers();
      unsubRoles();
      unsubPerms();
    };
  }, []);

  const paginatedUsers = React.useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return users.slice(startIndex, startIndex + pageSize);
  }, [users, currentPage, pageSize]);

  const totalPages = Math.ceil(users.length / pageSize);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const email = newUser.email.trim().toLowerCase();
      if (!email) return;

      // Check if user already exists
      const q = query(collection(db, 'users'), where('email', '==', email));
      const snap = await getDocs(q);
      
      if (!snap.empty) {
        alert('Un usuario con este correo ya existe');
        return;
      }

      await addDoc(collection(db, 'users'), {
        email,
        role: newUser.role,
        commission: newUser.commission || 0,
        canCreatePolicies: newUser.role === 'agent' ? (newUser.canCreatePolicies ?? true) : false,
        taxId: newUser.taxId || '',
        bankName: newUser.bankName || '',
        bankAccount: newUser.bankAccount || '',
        clabe: newUser.clabe || '',
        createdAt: serverTimestamp(),
        displayName: email.split('@')[0]
      });

      setIsAddingUser(false);
      setNewUser({ 
        email: '', 
        role: 'agent' as UserRole | string, 
        commission: 0,
        canCreatePolicies: true,
        taxId: '',
        bankName: '',
        bankAccount: '',
        clabe: ''
      });
      alert('Usuario pre-registrado con éxito');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'users');
    }
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    try {
      await updateDoc(doc(db, 'users', editingUser.uid), {
        role: editingUser.role,
        commission: editingUser.commission || 0,
        canCreatePolicies: editingUser.role === 'agent' ? (editingUser.canCreatePolicies || false) : false,
        taxId: editingUser.taxId || '',
        bankName: editingUser.bankName || '',
        bankAccount: editingUser.bankAccount || '',
        clabe: editingUser.clabe || ''
      });
      setEditingUser(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${editingUser.uid}`);
    }
  };

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRole) return;

    try {
      if (editingRole.id) {
        const { id, ...data } = editingRole;
        await updateDoc(doc(db, 'roles', id), data);
      } else {
        const { id, ...data } = editingRole; // Strip empty ID
        await addDoc(collection(db, 'roles'), {
          ...data,
          createdAt: serverTimestamp()
        });
      }
      setEditingRole(null);
      setIsAddingRole(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'roles');
    }
  };

  const handleDeleteRole = async (id: string) => {
    if (!id) return;
    setConfirmModal({
      isOpen: true,
      title: 'Eliminar Rol',
      message: '¿Estás seguro de eliminar este rol?',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'roles', id));
          alert('Rol eliminado con éxito');
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `roles/${id}`);
        }
      }
    });
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Configuración del Sistema</h1>
          <p className="text-gray-500">Gestiona usuarios, roles y permisos</p>
        </div>
        {activeTab === 'users' && (
          <button
            onClick={() => setIsAddingUser(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-2 shadow-lg shadow-blue-100"
          >
            <Plus className="w-4 h-4" />
            Pre-registrar Usuario
          </button>
        )}
      </header>

      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab('users')}
          className={`px-6 py-3 text-sm font-bold transition-all border-b-2 ${
            activeTab === 'users' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          Usuarios
        </button>
        <button
          onClick={() => setActiveTab('roles')}
          className={`px-6 py-3 text-sm font-bold transition-all border-b-2 ${
            activeTab === 'roles' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          Roles y Permisos
        </button>
      </div>

      {activeTab === 'users' ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Usuario</th>
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Rol Actual</th>
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Comisión</th>
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Emite Pólizas</th>
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {paginatedUsers.map((user) => (
                <tr key={user.uid} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs">
                        {user.displayName?.charAt(0) || user.email.charAt(0)}
                      </div>
                      <div>
                        <p className="font-bold text-gray-900 text-sm">{user.displayName || 'Sin nombre'}</p>
                        <p className="text-xs text-gray-400">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                      {SYSTEM_ROLES.find(r => r.id === user.role)?.name || customRoles.find(r => r.id === user.role)?.name || user.role}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {user.role === 'agent' ? `${user.commission || 0}%` : '-'}
                  </td>
                  <td className="px-6 py-4">
                    {user.role === 'agent' ? (
                      user.canCreatePolicies ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Habilitado
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-500">
                          Solo cotiza
                        </span>
                      )
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setEditingUser(user)}
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setConfirmModal({
                            isOpen: true,
                            title: 'Eliminar Acceso',
                            message: `¿Estás seguro de eliminar el acceso para ${user.email}?`,
                            onConfirm: async () => {
                              try {
                                await deleteDoc(doc(db, 'users', user.uid));
                                setConfirmModal(prev => ({ ...prev, isOpen: false }));
                              } catch (err) {
                                handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}`);
                              }
                            }
                          });
                        }}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination Controls */}
          {users.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-gray-50 px-6 py-4 border-t border-gray-100">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <p className="text-sm text-gray-500 font-semibold">
                  Mostrando <span className="font-bold text-gray-900">{users.length === 0 ? 0 : ((currentPage - 1) * pageSize) + 1}</span> a <span className="font-bold text-gray-900">{Math.min(currentPage * pageSize, users.length)}</span> de <span className="font-bold text-gray-900">{users.length}</span> usuarios
                </p>
                <div className="flex items-center gap-2 border-l border-gray-200 pl-4">
                  <span className="text-xs text-gray-500">Filas por página:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="px-2 py-1 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).filter(p => {
                    return p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1;
                  }).map((p, i, arr) => (
                    <React.Fragment key={p}>
                      {i > 0 && arr[i-1] !== p - 1 && <span className="text-gray-300 mx-1">...</span>}
                      <button
                        onClick={() => setCurrentPage(p)}
                        className={`min-w-[32px] h-8 rounded-lg text-xs font-bold transition-all ${
                          currentPage === p 
                            ? 'bg-blue-600 text-white shadow-md shadow-blue-100' 
                            : 'text-gray-500 hover:bg-gray-50 hover:text-blue-600'
                        }`}
                      >
                        {p}
                      </button>
                    </React.Fragment>
                  ))}
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-bold text-gray-900">Roles Personalizados</h2>
            <button
              onClick={() => {
                setIsAddingRole(true);
                setEditingRole({ id: '', name: '', description: '', permissions: [], menuPermissions: {}, createdAt: null });
              }}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Nuevo Rol
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* System Roles (Read Only) */}
            {SYSTEM_ROLES.map((role) => (
              <div key={`system-${role.id}`} className="bg-gray-50 rounded-xl p-6 border border-gray-200 opacity-75">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-gray-200 rounded-lg text-gray-600">
                    <Lock className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900">{role.name}</h3>
                    <span className="text-[10px] font-bold text-gray-400 uppercase">Sistema</span>
                  </div>
                </div>
                <p className="text-sm text-gray-500 mb-4">{role.description}</p>
                <div className="flex flex-wrap gap-2">
                  <span className="px-2 py-1 bg-white border border-gray-200 rounded text-[10px] font-bold text-gray-400">Acceso Total</span>
                </div>
              </div>
            ))}

            {/* Custom Roles */}
            {customRoles
              .filter(role => !SYSTEM_ROLES.some(sr => sr.id === role.id))
              .map((role, idx) => (
                <div key={`custom-${role.id || 'empty'}-${idx}`} className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm hover:shadow-md transition-all group">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
                      <Shield className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900">{role.name}</h3>
                      <span className="text-[10px] font-bold text-blue-400 uppercase">Personalizado</span>
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setEditingRole(role)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded">
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDeleteRole(role.id!)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-500 mb-4">{role.description}</p>
                <div className="flex flex-wrap gap-2">
                  {(role.permissions || []).map((pId, pIdx) => (
                    <span key={`${role.id || 'empty'}-${pId || 'empty'}-${pIdx}`} className="px-2 py-1 bg-blue-50 text-blue-600 rounded text-[10px] font-bold">
                      {permissions.find(p => p.id === pId)?.name || pId}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {isAddingUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h3 className="text-xl font-bold text-gray-900">Pre-registrar Usuario</h3>
              <button onClick={() => setIsAddingUser(false)} className="p-2 hover:bg-white rounded-full transition-colors">
                <X className="w-6 h-6 text-gray-400" />
              </button>
            </div>
            <form onSubmit={handleAddUser} className="p-8 space-y-6">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Correo Electrónico</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                  <input
                    type="email"
                    required
                    placeholder="email@ejemplo.com"
                    value={newUser.email}
                    onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                    className="w-full pl-10 p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <p className="text-[10px] text-gray-400 mt-1">El usuario podrá entrar usando este correo mediante OTP o Google.</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Rol Asignado</label>
                <select
                  value={newUser.role}
                  onChange={e => setNewUser({ ...newUser, role: e.target.value })}
                  className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-medium text-sm"
                >
                  <optgroup label="Roles de Sistema">
                    {SYSTEM_ROLES.map(r => <option key={`adduser-sys-${r.id}`} value={r.id}>{r.name}</option>)}
                  </optgroup>
                  <optgroup label="Roles Personalizados">
                    {customRoles.map(r => <option key={`adduser-cust-${r.id || Math.random()}`} value={r.id}>{r.name}</option>)}
                  </optgroup>
                </select>
              </div>

              {newUser.role === 'agent' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Comisión (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      value={newUser.commission}
                      onChange={e => setNewUser({ ...newUser, commission: parseFloat(e.target.value) || 0 })}
                      className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                    />
                  </div>

                  <label className="flex items-start gap-3 p-3.5 bg-blue-50/70 border border-blue-200 rounded-xl cursor-pointer hover:bg-blue-50 transition-colors">
                    <input
                      type="checkbox"
                      checked={newUser.canCreatePolicies ?? true}
                      onChange={e => setNewUser({ ...newUser, canCreatePolicies: e.target.checked })}
                      className="mt-0.5 w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                    />
                    <div>
                      <span className="text-xs font-bold text-gray-900 block">¿Permitir crear / emitir pólizas?</span>
                      <span className="text-[11px] text-gray-500 block leading-tight mt-0.5">
                        Si se activa, el agente podrá emitir pólizas directamente desde el sistema.
                      </span>
                    </div>
                  </label>

                  <div className="pt-2 border-t border-gray-100 space-y-3">
                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Datos para Liquidación e Invoices de Comisiones</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-gray-600 mb-1">RFC / Tax ID</label>
                        <input
                          type="text"
                          placeholder="RFC del agente"
                          value={newUser.taxId || ''}
                          onChange={e => setNewUser({ ...newUser, taxId: e.target.value.toUpperCase() })}
                          className="w-full p-2.5 border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-gray-600 mb-1">Banco</label>
                        <input
                          type="text"
                          placeholder="Ej. BBVA"
                          value={newUser.bankName || ''}
                          onChange={e => setNewUser({ ...newUser, bankName: e.target.value })}
                          className="w-full p-2.5 border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-600 mb-1">CLABE Interbancaria / Cuenta</label>
                      <input
                        type="text"
                        placeholder="CLABE a 18 dígitos"
                        value={newUser.clabe || ''}
                        onChange={e => setNewUser({ ...newUser, clabe: e.target.value, bankAccount: e.target.value })}
                        className="w-full p-2.5 border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-4 flex gap-4">
                <button
                  type="button"
                  onClick={() => setIsAddingUser(false)}
                  className="flex-1 px-6 py-3 border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all font-sans"
                >
                  Registrar Acceso
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* User Editor Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h3 className="text-xl font-bold text-gray-900">Editar Usuario</h3>
              <button onClick={() => setEditingUser(null)} className="p-2 hover:bg-white rounded-full transition-colors">
                <X className="w-6 h-6 text-gray-400" />
              </button>
            </div>
            <form onSubmit={handleSaveUser} className="p-8 space-y-6">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Usuario</label>
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold">
                    {editingUser.displayName?.charAt(0) || editingUser.email.charAt(0)}
                  </div>
                  <div>
                    <p className="font-bold text-gray-900">{editingUser.displayName || 'Sin nombre'}</p>
                    <p className="text-xs text-gray-400">{editingUser.email}</p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Rol del Sistema</label>
                <select
                  value={editingUser.role}
                  onChange={e => setEditingUser({ ...editingUser, role: e.target.value })}
                  className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-medium"
                >
                  <optgroup label="Roles de Sistema">
                    {SYSTEM_ROLES.map(r => <option key={`edituser-sys-${r.id}`} value={r.id}>{r.name}</option>)}
                  </optgroup>
                  <optgroup label="Roles Personalizados">
                    {customRoles.map(r => <option key={`edituser-cust-${r.id || Math.random()}`} value={r.id}>{r.name}</option>)}
                  </optgroup>
                </select>
              </div>

              {editingUser.role === 'agent' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Comisión (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={editingUser.commission || 0}
                      onChange={e => setEditingUser({ ...editingUser, commission: parseFloat(e.target.value) || 0 })}
                      className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                    />
                  </div>

                  <label className="flex items-start gap-3 p-3.5 bg-blue-50/70 border border-blue-200 rounded-xl cursor-pointer hover:bg-blue-50 transition-colors">
                    <input
                      type="checkbox"
                      checked={editingUser.canCreatePolicies || false}
                      onChange={e => setEditingUser({ ...editingUser, canCreatePolicies: e.target.checked })}
                      className="mt-0.5 w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                    />
                    <div>
                      <span className="text-xs font-bold text-gray-900 block">¿Permitir crear / emitir pólizas?</span>
                      <span className="text-[11px] text-gray-500 block leading-tight mt-0.5">
                        Si se activa, el agente podrá emitir pólizas directamente desde el sistema con su comisión asignada.
                      </span>
                    </div>
                  </label>

                  <div className="pt-2 border-t border-gray-100 space-y-3">
                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Datos para Liquidación e Invoices de Comisiones</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-gray-600 mb-1">RFC / Tax ID</label>
                        <input
                          type="text"
                          placeholder="RFC del agente"
                          value={editingUser.taxId || ''}
                          onChange={e => setEditingUser({ ...editingUser, taxId: e.target.value.toUpperCase() })}
                          className="w-full p-2.5 border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-gray-600 mb-1">Banco</label>
                        <input
                          type="text"
                          placeholder="Ej. BBVA"
                          value={editingUser.bankName || ''}
                          onChange={e => setEditingUser({ ...editingUser, bankName: e.target.value })}
                          className="w-full p-2.5 border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-600 mb-1">CLABE Interbancaria / Cuenta</label>
                      <input
                        type="text"
                        placeholder="CLABE a 18 dígitos"
                        value={editingUser.clabe || editingUser.bankAccount || ''}
                        onChange={e => setEditingUser({ ...editingUser, clabe: e.target.value, bankAccount: e.target.value })}
                        className="w-full p-2.5 border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-4 flex gap-4">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="flex-1 px-6 py-3 border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all"
                >
                  Guardar Cambios
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Role Editor Modal */}
      {(editingRole || isAddingRole) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h3 className="text-xl font-bold text-gray-900">
                {editingRole?.id ? 'Editar Rol' : 'Nuevo Rol Personalizado'}
              </h3>
              <button onClick={() => { setEditingRole(null); setIsAddingRole(false); }} className="p-2 hover:bg-white rounded-full transition-colors">
                <X className="w-6 h-6 text-gray-400" />
              </button>
            </div>
            <form onSubmit={handleSaveRole} className="p-8 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Nombre del Rol</label>
                  <input
                    type="text"
                    required
                    placeholder="Ej: Supervisor de Ventas"
                    value={editingRole?.name || ''}
                    onChange={e => setEditingRole({ ...editingRole!, name: e.target.value })}
                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Descripción</label>
                  <textarea
                    rows={2}
                    value={editingRole?.description || ''}
                    onChange={e => setEditingRole({ ...editingRole!, description: e.target.value })}
                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-3">Permisos Asignados</label>
                <div className="grid grid-cols-2 gap-3 max-h-48 overflow-y-auto p-1">
                  {permissions.map(perm => (
                    <label key={perm.id} className="flex items-center gap-3 p-3 border border-gray-100 rounded-xl hover:bg-gray-50 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={(editingRole?.permissions || []).includes(perm.id)}
                        onChange={e => {
                          const perms = e.target.checked
                            ? [...(editingRole?.permissions || []), perm.id]
                            : (editingRole?.permissions || []).filter(id => id !== perm.id);
                          setEditingRole({ ...editingRole!, permissions: perms });
                        }}
                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                      />
                      <div>
                        <p className="text-sm font-bold text-gray-900">{perm.name}</p>
                        <p className="text-[10px] text-gray-400">{perm.description}</p>
                      </div>
                    </label>
                  ))}
                  {permissions.length === 0 && (
                    <p className="col-span-2 text-center py-4 text-gray-400 text-xs italic">Cargando permisos...</p>
                  )}
                </div>
              </div>

              <div className="pt-4 flex gap-4">
                <button
                  type="button"
                  onClick={() => { setEditingRole(null); setIsAddingRole(false); }}
                  className="flex-1 px-6 py-3 border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all"
                >
                  Guardar Rol
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Modal */}
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
