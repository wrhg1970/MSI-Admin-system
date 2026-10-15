import React, { useState, useEffect } from 'react';
import { signInWithPopup, GoogleAuthProvider, signInAnonymously, signInWithEmailAndPassword } from 'firebase/auth';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { Shield, Mail, ArrowRight, Loader2, Key, CheckCircle2, AlertCircle, Lock, User } from 'lucide-react';

export default function Auth() {
  const [method, setMethod] = useState<'google' | 'password' | 'email'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const authError = localStorage.getItem('auth_error');
    if (authError) {
      setError(authError);
      localStorage.removeItem('auth_error');
    }
  }, []);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error('Login failed:', error);
      setError('Error al iniciar sesión con Google');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setError(null);
    const normalizedEmail = email.trim().toLowerCase();

    try {
      // 1. Try standard Firebase Auth email/password login
      try {
        await signInWithEmailAndPassword(auth, normalizedEmail, password);
        localStorage.setItem('verified_email', normalizedEmail);
        setLoading(false);
        return;
      } catch (authErr: any) {
        console.warn("Firebase Auth password login failed, checking pre-registered profile:", authErr.code || authErr.message);
      }

      // 2. Check if pre-registered in Firestore users collection
      const q = query(collection(db, 'users'), where('email', '==', normalizedEmail));
      const snap = await getDocs(q);

      if (!snap.empty) {
        // User exists in Firestore system
        localStorage.setItem('verified_email', normalizedEmail);
        await signInAnonymously(auth);
      } else {
        setError('Usuario o contraseña no reconocidos. Solicite registro a un Administrador o use Código OTP.');
      }
    } catch (err: any) {
      setError(err.message || 'Error al iniciar sesión con usuario y contraseña');
    } finally {
      setLoading(false);
    }
  };

  const readJson = async (resp: Response) => {
    const text = await resp.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new Error('El servidor no respondió. Espere unos segundos e intente de nuevo.');
    }
  };

  const handleRequestOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    const normalizedEmail = email.trim().toLowerCase();
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail })
      });
      const data = await readJson(resp);
      if (!resp.ok) throw new Error(data.error || 'Error al enviar código');
      
      setMessage(data.message || `Código enviado a ${normalizedEmail}`);
      if (data.devCode) {
        const digits = data.devCode.split('');
        setOtp(digits);
      }
      setStep('verify');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = otp.join('').trim();
    if (code.length !== 6) return;
    const normalizedEmail = email.trim().toLowerCase();
    
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, code })
      });
      const data = await readJson(resp);
      if (!resp.ok) throw new Error(data.error || 'Código inválido');
      
      localStorage.setItem('verified_email', normalizedEmail);
      await signInAnonymously(auth);
    } catch (err: any) {
      const code = String(err?.code || '');
      if (code.includes('operation-not-allowed') || code.includes('admin-restricted')) {
        localStorage.removeItem('verified_email');
        setError('El acceso anónimo de Firebase está desactivado. Pida habilitarlo en Authentication para entrar con OTP.');
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (value.length > 1) return;
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    // Auto-focus next
    if (value && index < 5) {
      const nextInput = document.getElementById(`otp-${index + 1}`);
      nextInput?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    const paste = e.clipboardData.getData('text').trim();
    if (/^\d{6}$/.test(paste)) {
      e.preventDefault();
      setOtp(paste.split(''));
      const lastInput = document.getElementById('otp-5');
      lastInput?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      const prevInput = document.getElementById(`otp-${index - 1}`);
      prevInput?.focus();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#1A2138] px-4 overflow-hidden relative">
      <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-blue-500/10 to-transparent pointer-events-none" />
      <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-cyan-400/5 rounded-full blur-3xl pointer-events-none" />
      
      <div className="max-w-md w-full bg-white rounded-[2.5rem] shadow-2xl p-10 text-center relative z-10 border border-gray-100">
        <div className="flex justify-center mb-8">
          <div className="p-5 bg-gradient-to-br from-[#06b6d4] to-[#1e40af] rounded-3xl shadow-xl shadow-blue-100">
            <Shield className="w-14 h-14 text-white" />
          </div>
        </div>
        <h1 className="text-4xl font-black text-[#1A2138] mb-2 tracking-tight">MSI <span className="text-[#06b6d4]">Admin</span></h1>
        <p className="text-gray-500 font-bold text-sm mb-8 uppercase tracking-widest">Global Insurance Management</p>

        {/* Method tabs */}
        <div className="bg-gray-100 p-1 rounded-2xl flex text-xs font-bold mb-6">
          <button
            type="button"
            onClick={() => { setMethod('email'); setStep('request'); setError(null); setMessage(null); }}
            className={`flex-1 py-2.5 rounded-xl transition-all ${method === 'email' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
          >
            Acceso OTP (Agentes)
          </button>
          <button
            type="button"
            onClick={() => { setMethod('password'); setError(null); setMessage(null); }}
            className={`flex-1 py-2.5 rounded-xl transition-all ${method === 'password' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
          >
            Usuario/Clave
          </button>
          <button
            type="button"
            onClick={() => { setMethod('google'); setError(null); setMessage(null); }}
            className={`flex-1 py-2.5 rounded-xl transition-all ${method === 'google' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
          >
            Google
          </button>
        </div>
        
        {method === 'google' ? (
          <div className="space-y-4">
            <button
              onClick={handleGoogleLogin}
              disabled={loading}
              className="w-full flex items-center justify-center gap-4 bg-white border-2 border-gray-100 text-[#1A2138] font-black py-4 px-6 rounded-2xl hover:border-blue-200 hover:bg-blue-50/50 transition-all shadow-sm group disabled:opacity-50"
            >
              <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5 grayscale group-hover:grayscale-0 transition-all" referrerPolicy="no-referrer" />
              <span className="text-sm uppercase tracking-tighter">
                {loading ? 'Cargando...' : 'Iniciar sesión con Google'}
              </span>
            </button>
          </div>
        ) : method === 'password' ? (
          <form onSubmit={handlePasswordLogin} className="space-y-4 text-left">
            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Usuario / Correo</label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="agente@miseguro.com"
                  className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium text-sm"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Contraseña</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium text-sm"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Ingresar al Sistema <ArrowRight className="w-4 h-4" /></>}
            </button>
          </form>
        ) : (
          <div className="space-y-6">
            {step === 'request' ? (
              <form onSubmit={handleRequestOTP} className="space-y-4 text-left">
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Correo Electrónico</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="ejemplo@miseguro.com"
                      className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium text-sm"
                      required
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading || !email}
                  className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Enviar Código <ArrowRight className="w-4 h-4" /></>}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOTP} className="space-y-6 text-left">
                <div className="text-center space-y-2">
                  <div className="flex justify-center">
                    <div className="p-3 bg-green-50 rounded-full">
                      <Key className="w-6 h-6 text-green-600" />
                    </div>
                  </div>
                  <h3 className="text-lg font-black text-gray-900">Verifica tu correo</h3>
                  <p className="text-xs text-gray-500 font-medium">Ingresa el código de 6 dígitos enviado a <br/><span className="text-blue-600">{email}</span></p>
                </div>

                <div className="flex justify-between gap-2" onPaste={handleOtpPaste}>
                  {otp.map((digit, idx) => (
                    <input
                      key={idx}
                      id={`otp-${idx}`}
                      type="text"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleOtpChange(idx, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(idx, e)}
                      onPaste={handleOtpPaste}
                      className="w-12 h-14 bg-gray-50 border border-gray-100 rounded-xl text-center text-xl font-black text-[#1A2138] focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all shadow-sm"
                    />
                  ))}
                </div>

                <button
                  type="submit"
                  disabled={loading || otp.some(d => !d)}
                  className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Verificar y Entrar'}
                </button>

                <button
                  type="button"
                  onClick={() => setStep('request')}
                  className="w-full text-[10px] font-black text-gray-400 hover:text-gray-600 transition-colors uppercase tracking-widest text-center"
                >
                  Editar correo o reenviar
                </button>
              </form>
            )}
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded-xl flex items-center gap-2 animate-shake text-left">
            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
            <p className="text-[10px] text-red-600 font-bold uppercase tracking-tighter">{error}</p>
          </div>
        )}

        {message && !error && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-xl flex items-center gap-2 text-left">
            <CheckCircle2 className="w-4 h-4 text-blue-600 flex-shrink-0" />
            <p className="text-[10px] text-blue-600 font-bold uppercase tracking-tighter">{message}</p>
          </div>
        )}
        
        <div className="mt-8 pt-6 border-t border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] opacity-50">
          &copy; 2026 MiSeguroInternacional
        </div>
      </div>
    </div>
  );
}
