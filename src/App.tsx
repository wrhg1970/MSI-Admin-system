import { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp, collection, query, where, getDocs, deleteDoc, onSnapshot, updateDoc, limit } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { UserProfile, CustomRole } from './types';
import { INITIAL_POLICIES, COUNTRIES } from './constants';
import firebaseConfig from '../firebase-applet-config.json';
import Layout from './components/Layout';
import AppSafeFallback from './components/AppSafeFallback';
import { createContext, useContext } from 'react';
import { FirestoreDataProvider } from './context/FirestoreDataContext';

// Create a context for company settings
export const CompanyContext = createContext<{ settings: any }>({ settings: null });
export const useCompany = () => useContext(CompanyContext);

// Helper function to auto-retry lazy loading when a dynamic import fails (e.g. after build updates or dev server changes)
function lazyWithRetry<T extends React.ComponentType<any>>(
  componentImport: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    try {
      const component = await componentImport();
      window.sessionStorage.removeItem('retry-lazy-refreshed');
      return component;
    } catch (error: any) {
      const isDynamicImportError =
        error?.message?.includes('dynamically imported module') ||
        error?.message?.includes('Importing a module script failed') ||
        error?.message?.includes('Failed to fetch') ||
        error?.name === 'ChunkLoadError';

      const refreshed = window.sessionStorage.getItem('retry-lazy-refreshed');
      if (isDynamicImportError && !refreshed) {
        window.sessionStorage.setItem('retry-lazy-refreshed', 'true');
        window.location.reload();
        return new Promise<{ default: T }>(() => {});
      }
      throw error;
    }
  });
}

// Lazy load components with retry
const Home = lazyWithRetry(() => import('./components/Home'));
const Dashboard = lazyWithRetry(() => import('./components/Dashboard'));
const InsuranceForm = lazyWithRetry(() => import('./components/InsuranceForm'));
const AdminPanel = lazyWithRetry(() => import('./components/AdminPanel'));
const PoliciesManager = lazyWithRetry(() => import('./components/PoliciesManager'));
const ClientsManager = lazyWithRetry(() => import('./components/ClientsManager'));
const CatalogsManager = lazyWithRetry(() => import('./components/CatalogsManager'));
const CommissionsManager = lazyWithRetry(() => import('./components/CommissionsManager'));
const InsurancePlansManager = lazyWithRetry(() => import('./components/InsurancePlansManager'));
const ClaimsManager = lazyWithRetry(() => import('./components/ClaimsManager'));
const ProvidersManager = lazyWithRetry(() => import('./components/ProvidersManager'));
const ReportsManager = lazyWithRetry(() => import('./components/ReportsManager'));
const ConfigPanel = lazyWithRetry(() => import('./components/ConfigPanel'));
const NotificationsManager = lazyWithRetry(() => import('./components/NotificationsManager'));
const HistoricoManager = lazyWithRetry(() => import('./components/HistoricoManager'));
const QuoteForm = lazyWithRetry(() => import('./components/QuoteForm'));
const Auth = lazyWithRetry(() => import('./components/Auth'));

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [rolePermissions, setRolePermissions] = useState<CustomRole | null>(null);
  const [companySettings, setCompanySettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubCompany: (() => void) | null = null;
    let unsubProfile: (() => void) | null = null;
    let unsubRole: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Listen to company settings only when authenticated
        if (!unsubCompany) {
          unsubCompany = onSnapshot(doc(db, 'settings', 'company'), (docSnap) => {
            if (docSnap.exists()) {
              setCompanySettings(docSnap.data());
            }
          }, (error) => {
            console.warn("Could not fetch company settings reactively (possible quota or network issue):", error);
            // Fallback default settings so the app doesn't break
            setCompanySettings({
              companyName: 'Mi Seguro Internacional',
              email: 'ventas@misegurointernacional.com',
              phone: '',
              address: ''
            });
          });
        }

        const emailAttr = firebaseUser.email || (firebaseUser.isAnonymous ? localStorage.getItem('verified_email') : null);
        const verifiedEmail = emailAttr?.toLowerCase();
        
        // If anonymous but no verified email, sign out
        if (firebaseUser.isAnonymous && !verifiedEmail) {
          await auth.signOut();
          setUser(null);
          setProfile(null);
          setLoading(false);
          return;
        }

        setUser(firebaseUser);
        const superAdmins = ['ventas@misegurointernacional.com', 'wrhg1970@gmail.com'];
        const isSuperAdmin = verifiedEmail && superAdmins.includes(verifiedEmail);

        // Heavy startup correction and seed tasks - optimized to run exactly once per database for super admin
        const sysInitKey = `sys_init_done_v5_${firebaseConfig.projectId}_${firebaseConfig.firestoreDatabaseId || 'default'}`;
        const sysInitDone = typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem(sysInitKey) === 'true';
        if (!sysInitDone && isSuperAdmin) {
          Promise.all([
            // 1. Seed or correct Countries
            getDocs(query(collection(db, 'countries'), limit(1))).then(async (snap) => {
              if (snap.empty) {
                const { addDoc } = await import('firebase/firestore');
                for (const c of COUNTRIES) {
                  await addDoc(collection(db, 'countries'), c);
                }
                console.log("Successfully auto-seeded countries catalog.");
              } else {
                // Ensure region updates are accurate for existing records
                getDocs(query(collection(db, 'countries'), where('code', 'in', ['CA', 'US', 'WW']))).then((countrySnap) => {
                  countrySnap.forEach(async (docSnap) => {
                    if (docSnap.data().region !== 1) {
                      await updateDoc(docSnap.ref, { region: 1 });
                      console.log(`Successfully auto-updated ${docSnap.data().code} in Firestore to Region 1 (Zona 1)`);
                    }
                  });
                });
                getDocs(query(collection(db, 'countries'), where('code', 'in', ['ES', 'FR', 'DE', 'GB']))).then((countrySnap) => {
                  countrySnap.forEach(async (docSnap) => {
                    if (docSnap.data().region !== 2) {
                      await updateDoc(docSnap.ref, { region: 2 });
                      console.log(`Successfully auto-updated ${docSnap.data().code} in Firestore to Region 2 (Zona 2)`);
                    }
                  });
                });
              }
            }),
            // 2. Auto-correct Karim Yuseff's and other insureds' (Invoice 872229) calculations
            getDocs(collection(db, 'insurances')).then((snap) => {
              snap.forEach(async (docSnap) => {
                const data = docSnap.data();
                if (data.InvoiceCaremed === '872229') {
                  const docId = docSnap.id;
                  let correct = null;
                  if (docId === 'pgHH3DyIdtnCdsOUhMcX' || (data.firstName && data.firstName.toLowerCase().includes('karim'))) {
                    correct = { totalCost: 84.15, totalPrice: 320.00, totalFinal: 320.00, discount: 0 };
                  } else if (docId === '031Dgp1ctxlvXK8T8Z5d' || (data.firstName === 'Regina' && data.lastName === 'Ibarguengoytia Bonilla')) {
                    correct = { totalCost: 35.10, totalPrice: 110.50, totalFinal: 110.50, discount: 0 };
                  } else if (docId === '1s1RaDBvyQfUsRFBUVTM' || (data.firstName === 'Patricio' && data.lastName === 'Lopez Davila')) {
                    correct = { totalCost: 51.66, totalPrice: 157.50, totalFinal: 157.50, discount: 0 };
                  } else if (docId === '7VMpgkNRbSU9X088TucF' || (data.firstName === 'Marcel' && data.lastName === 'Ravize Villarreal')) {
                    correct = { totalCost: 49.14, totalPrice: 229.50, totalFinal: 229.50, discount: 0 };
                  } else if (docId === '92P7P4EcfprJTin6LFKu' || (data.firstName === 'Lissette' && data.lastName === 'Ravize Villarreal')) {
                    correct = { totalCost: 38.22, totalPrice: 178.50, totalFinal: 178.50, discount: 0 };
                  } else if (docId === 'Eq7T04kaA1thr5wmul3E' || (data.firstName === 'Sophia' && data.lastName === 'Morales Aguirre')) {
                    correct = { totalCost: 78.72, totalPrice: 240.00, totalFinal: 240.00, discount: 0 };
                  } else if (docId === 'MLuwb19ZXPn8QS9EJsxH' || (data.firstName === 'Anastasia' && data.lastName === 'Montemayor Berthova')) {
                    correct = { totalCost: 49.50, totalPrice: 225.00, totalFinal: 225.00, discount: 0 };
                  } else if (docId === 'Or0VezXsz9K9x3zOe2TW' || (data.firstName === 'Jesus Alberto' && data.lastName === 'Garcia Arreola')) {
                    correct = { totalCost: 23.66, totalPrice: 110.50, totalFinal: 110.50, discount: 0 };
                  } else if (docId === 'ZPXmZtvbVmIhAoCzwxYy' || (data.firstName === 'Raquel' && data.lastName === 'Sagaon Villarreal')) {
                    correct = { totalCost: 45.50, totalPrice: 212.50, totalFinal: 212.50, discount: 0 };
                  }

                  if (correct) {
                    const needsUpdate = data.totalCost !== correct.totalCost || 
                                        data.totalPrice !== correct.totalPrice || 
                                        data.totalFinal !== correct.totalFinal ||
                                        data.discount !== correct.discount;
                    if (needsUpdate) {
                      await updateDoc(docSnap.ref, correct);
                      console.log(`Successfully auto-corrected ${data.firstName} ${data.lastName} (Invoice 872229) in Firestore.`);
                    }
                  }
                }
              });
            }),
            // 3. Seed or correct Policies
            getDocs(query(collection(db, 'policies'), limit(1))).then(async (snap) => {
              if (snap.empty) {
                const { addDoc, serverTimestamp } = await import('firebase/firestore');
                for (const p of INITIAL_POLICIES) {
                  await addDoc(collection(db, 'policies'), {
                    ...p,
                    status: 'active',
                    createdAt: serverTimestamp()
                  });
                }
                console.log("Successfully auto-seeded policies catalog.");
              } else {
                getDocs(collection(db, 'policies')).then(async (policySnap) => {
                  const existingDBPolicies: any[] = [];
                  policySnap.forEach((docSnap) => {
                    existingDBPolicies.push({
                      id: docSnap.id,
                      ref: docSnap.ref,
                      ...docSnap.data()
                    });
                  });

                  for (const docData of existingDBPolicies) {
                    const match = INITIAL_POLICIES.find(p =>
                      p.plan?.toLowerCase() === docData.plan?.toLowerCase() &&
                      p.name?.toLowerCase() === docData.name?.toLowerCase() &&
                      !!p.deductible === !!docData.deductible &&
                      Number(p.region) === Number(docData.region)
                    );
                    if (match) {
                      const needsUpdate = 
                        docData.pricePerDay !== match.pricePerDay || 
                        docData.costPerDay !== match.costPerDay || 
                        docData.pricePerMonth !== match.pricePerMonth ||
                        docData.discountPercentage !== match.discountPercentage;
                      if (needsUpdate) {
                        await updateDoc(docData.ref, {
                          pricePerDay: match.pricePerDay,
                          costPerDay: match.costPerDay,
                          pricePerMonth: match.pricePerMonth || null,
                          discountPercentage: match.discountPercentage || 0
                        });
                        console.log(`Successfully auto-synced price for policy: ${docData.name} - ${docData.plan} (Region ${docData.region})`);
                      }
                    }
                  }

                  for (const p of INITIAL_POLICIES) {
                    const alreadyExists = existingDBPolicies.some(existing => 
                      existing.name?.toLowerCase() === p.name?.toLowerCase() &&
                      existing.plan?.toLowerCase() === p.plan?.toLowerCase() &&
                      Number(existing.region) === Number(p.region) &&
                      !!existing.deductible === !!p.deductible
                    );
                    if (!alreadyExists) {
                      const { addDoc, serverTimestamp } = await import('firebase/firestore');
                      await addDoc(collection(db, 'policies'), {
                        ...p,
                        status: 'active',
                        createdAt: serverTimestamp()
                      });
                      console.log(`Successfully auto-seeded missing policy: ${p.name} - ${p.plan} (Region ${p.region})`);
                    }
                  }
                });
              }
            }),
            // 4. Seed Company Settings
            getDoc(doc(db, 'settings', 'company')).then(async (companySnap) => {
              if (!companySnap.exists()) {
                await setDoc(doc(db, 'settings', 'company'), {
                  companyName: 'Mi Seguro Internacional',
                  email: 'ventas@misegurointernacional.com',
                  phone: '',
                  address: ''
                });
                console.log("Successfully auto-seeded default company settings.");
              }
            })
          ]).then(() => {
            if (typeof window !== 'undefined' && window.localStorage) {
              window.localStorage.setItem(sysInitKey, 'true');
            }
          }).catch(err => {
            console.warn("Gracefully handled quota or connection limit during heavy startup queries:", err);
          });
        }

        const docRef = doc(db, 'users', firebaseUser.uid);
        
        // Listen to user profile
        unsubProfile = onSnapshot(docRef, async (docSnap) => {
          let userProfile: UserProfile;
          if (docSnap.exists()) {
            userProfile = docSnap.data() as UserProfile;
            
            // Check if user should be super_admin but isn't
            if (isSuperAdmin && userProfile.role !== 'super_admin') {
              userProfile.role = 'super_admin';
              await updateDoc(docRef, { role: 'super_admin' });
            }

            // Ensure email is set if it was anonymous
            if (!userProfile.email && verifiedEmail) {
              userProfile.email = verifiedEmail;
              await updateDoc(docRef, { email: verifiedEmail });
            }
                  } else {
            // Check if there's a pre-registered user by email
            const usersRef = collection(db, 'users');
            const q = query(usersRef, where('email', '==', verifiedEmail || ''));
            const querySnapshot = await getDocs(q);
            
            let preRegisteredData: any = null;
            if (querySnapshot && !querySnapshot.empty && verifiedEmail) {
              // Found a pre-registered user
              const preRegDoc = querySnapshot.docs[0];
              preRegisteredData = preRegDoc.data();
              
              // Delete the pre-registration doc (if it's not the same as current docRef)
              if (preRegDoc.id !== firebaseUser.uid) {
                try {
                  await deleteDoc(doc(db, 'users', preRegDoc.id));
                } catch (e) {
                  console.warn("Error deleting pre-registered doc:", e);
                }
              }
            } else if (!isSuperAdmin) {
              // User is NOT pre-registered AND NOT a super admin! Block them!
              console.warn(`Blocking login for unregistered user: ${verifiedEmail}`);
              localStorage.setItem('auth_error', 'Acceso denegado. Su cuenta no está dada de alta en el sistema. Por favor, contacte a un administrador.');
              localStorage.removeItem('verified_email');
              
              if (unsubCompany) { unsubCompany(); unsubCompany = null; }
              if (unsubProfile) { unsubProfile(); unsubProfile = null; }
              if (unsubRole) { unsubRole(); unsubRole = null; }
              
              await auth.signOut();
              setUser(null);
              setProfile(null);
              setLoading(false);
              return;
            }

            // Create profile for new users
            userProfile = {
              uid: firebaseUser.uid,
              email: verifiedEmail || '',
              displayName: firebaseUser.displayName || preRegisteredData?.displayName || '',
              role: isSuperAdmin ? 'super_admin' : (preRegisteredData?.role || 'client'),
              commission: preRegisteredData?.commission || 0,
              createdAt: preRegisteredData?.createdAt || serverTimestamp(),
            };
            try {
              await setDoc(docRef, userProfile);
            } catch (error) {
              console.warn("Could not save new user profile (possible quota or permission limit):", error);
            }
          }
          setProfile(userProfile);

          // Fetch role permissions reactively if it's a custom role name
          if (userProfile.role && userProfile.role !== 'super_admin') {
            if (unsubRole) unsubRole();
            unsubRole = onSnapshot(doc(db, 'roles', userProfile.role), (roleDoc) => {
              if (roleDoc.exists()) {
                setRolePermissions(roleDoc.data() as CustomRole);
              } else {
                setRolePermissions(null);
              }
            }, (error) => {
              console.warn("Error fetching custom role permissions (using local role defaults):", error);
              setRolePermissions(null);
            });
          } else {
            if (unsubRole) unsubRole();
            setRolePermissions(null);
          }
        }, async (error) => {
          console.warn("Error reactively listening to user profile, trying local get:", error);
          try {
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
              setProfile(docSnap.data() as UserProfile);
            } else {
              throw new Error("No profile found in local cache");
            }
          } catch (cacheErr) {
            console.warn("Local profile get failed, using fallback profile based on Auth state:", cacheErr);
            // Fallback profile to prevent loading loop or crash when quota is hit
            const fallbackProfile: UserProfile = {
              uid: firebaseUser.uid,
              email: verifiedEmail || '',
              displayName: firebaseUser.displayName || 'Asesor (Modo Cache)',
              role: isSuperAdmin ? 'super_admin' : 'agent', // Fallback to agent to allow browsing if we can't fetch roles
              commission: 0,
              createdAt: new Date().toISOString()
            };
            setProfile(fallbackProfile);
          }
        });

        setUser(firebaseUser);

        // We should store unsubProfile to clean up if needed, but App.tsx usually stays mounted
      } else {
        if (unsubCompany) { unsubCompany(); unsubCompany = null; }
        if (unsubProfile) { unsubProfile(); unsubProfile = null; }
        if (unsubRole) { unsubRole(); unsubRole = null; }
        setUser(null);
        setProfile(null);
        setRolePermissions(null);
      }
      setLoading(false);
    });

    return () => {
      unsubscribe();
      if (unsubCompany) unsubCompany();
      if (unsubProfile) unsubProfile();
      if (unsubRole) unsubRole();
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    return <Auth />;
  }

  const hasPermission = (menuId: string, action: 'view' | 'create' | 'edit' | 'delete' = 'view') => {
    if (profile?.role === 'super_admin') return true;
    
    // Default system roles permissions if no custom role found
    if (!rolePermissions) {
      if (profile?.role === 'admin' || profile?.role === 'director') return true;
      if (profile?.role === 'seguros') return ['dashboard', 'request', 'clients', 'policies', 'catalogs', 'insurance-plans', 'providers', 'claims', 'historico'].includes(menuId);
      if (profile?.role === 'administracion') return ['dashboard', 'reports', 'commissions', 'providers', 'historico'].includes(menuId);
      if (profile?.role === 'agent') {
        if (['dashboard', 'request', 'clients', 'policies', 'commissions', 'historico'].includes(menuId)) return action === 'view' || action === 'create' || action === 'edit';
        return false;
      }
      if (profile?.role === 'client') {
        if (['dashboard', 'request', 'policies', 'historico'].includes(menuId)) return action === 'view';
        return false;
      }
      return false;
    }

    return rolePermissions.menuPermissions?.[menuId]?.[action] || false;
  };

  return (
    <AppSafeFallback>
      <CompanyContext.Provider value={{ settings: companySettings }}>
        <FirestoreDataProvider userId={user?.uid}>
          <Router>
            <Layout profile={profile} rolePermissions={rolePermissions} companySettings={companySettings}>
              <Suspense fallback={<LoadingScreen />}>
                <Routes>
                  <Route path="/" element={<Home profile={profile} rolePermissions={rolePermissions} />} />
                  <Route path="/dashboard" element={hasPermission('dashboard') ? <Dashboard profile={profile} /> : <Navigate to="/" />} />
                  <Route path="/request" element={hasPermission('request') ? <InsuranceForm profile={profile} /> : <Navigate to="/" />} />
                  <Route path="/quote" element={hasPermission('request') ? <QuoteForm profile={profile} /> : <Navigate to="/" />} />
                  <Route path="/clients" element={hasPermission('clients') ? <ClientsManager profile={profile} rolePermissions={rolePermissions} /> : <Navigate to="/" />} />
                  <Route path="/providers" element={hasPermission('providers') ? <ProvidersManager profile={profile} rolePermissions={rolePermissions} /> : <Navigate to="/" />} />
                  <Route path="/policies" element={hasPermission('policies') ? <PoliciesManager profile={profile} rolePermissions={rolePermissions} /> : <Navigate to="/" />} />
                  <Route path="/historico" element={hasPermission('historico') ? <HistoricoManager profile={profile} /> : <Navigate to="/" />} />
                  <Route path="/catalogs" element={hasPermission('catalogs') ? <CatalogsManager profile={profile} rolePermissions={rolePermissions} /> : <Navigate to="/" />} />
                  <Route path="/admin" element={hasPermission('admin') ? <AdminPanel profile={profile} rolePermissions={rolePermissions} /> : <Navigate to="/" />} />
                  <Route path="/commissions" element={hasPermission('commissions') ? <CommissionsManager profile={profile} rolePermissions={rolePermissions} /> : <Navigate to="/" />} />
                  <Route path="/reports" element={hasPermission('reports') ? <ReportsManager profile={profile} rolePermissions={rolePermissions} /> : <Navigate to="/" />} />
                  <Route path="/insurance-plans" element={hasPermission('insurance-plans') ? <InsurancePlansManager profile={profile} rolePermissions={rolePermissions} /> : <Navigate to="/" />} />
                  <Route path="/claims" element={hasPermission('claims') ? <ClaimsManager profile={profile} rolePermissions={rolePermissions} /> : <Navigate to="/" />} />
                  <Route path="/notifications" element={hasPermission('notifications') ? <NotificationsManager profile={profile} rolePermissions={rolePermissions} /> : <Navigate to="/" />} />
                  <Route path="/config" element={hasPermission('config') ? <ConfigPanel profile={profile} rolePermissions={rolePermissions} /> : <Navigate to="/" />} />
                  <Route path="*" element={<Navigate to="/" />} />
                </Routes>
              </Suspense>
            </Layout>
          </Router>
        </FirestoreDataProvider>
      </CompanyContext.Provider>
    </AppSafeFallback>
  );
}
