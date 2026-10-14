import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  limit, 
  Firestore,
  DocumentData,
  where
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { 
  Client, 
  InsuranceRequest, 
  Payment, 
  Provider, 
  Policy, 
  Country, 
  Category, 
  Subcategory, 
  UserProfile,
  Task,
  PolicyLetter
} from '../types';

interface FirestoreDataContextType {
  clients: Client[];
  insurances: InsuranceRequest[];
  payments: Payment[];
  providers: Provider[];
  policies: Policy[];
  countries: Country[];
  categories: Category[];
  subcategories: Subcategory[];
  exchangeRates: any[];
  latestExchangeRate: number;
  users: UserProfile[];
  paymentMethods: any[];
  insuranceTypes: any[];
  actionTypes: any[];
  policyLetters: PolicyLetter[];
  tasks: Task[];
  loading: {
    clients: boolean;
    insurances: boolean;
    payments: boolean;
    providers: boolean;
    policies: boolean;
    countries: boolean;
    categories: boolean;
    subcategories: boolean;
    exchangeRates: boolean;
    users: boolean;
    paymentMethods: boolean;
    insuranceTypes: boolean;
    actionTypes: boolean;
    policyLetters: boolean;
    tasks: boolean;
  };
  isFullyLoaded: boolean;
  refreshAll: () => void;
  limitToCurrentMonth: boolean;
  setLimitToCurrentMonth: (limit: boolean) => void;
  quotaExceeded: boolean;
  setQuotaExceeded: (exceeded: boolean) => void;
}

const FirestoreDataContext = createContext<FirestoreDataContextType | undefined>(undefined);

export function useFirestoreData() {
  const context = useContext(FirestoreDataContext);
  if (!context) {
    throw new Error('useFirestoreData must be used within a FirestoreDataProvider');
  }
  return context;
}

interface FirestoreDataProviderProps {
  children: ReactNode;
  userId: string | undefined;
}

export function FirestoreDataProvider({ children, userId }: FirestoreDataProviderProps) {
  const [clients, setClients] = useState<Client[]>([]);
  const [insurances, setInsurances] = useState<InsuranceRequest[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [exchangeRates, setExchangeRates] = useState<any[]>([]);
  const [latestExchangeRate, setLatestExchangeRate] = useState<number>(18.0); // Safe fallback
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [insuranceTypes, setInsuranceTypes] = useState<any[]>([]);
  const [actionTypes, setActionTypes] = useState<any[]>([]);
  const [policyLetters, setPolicyLetters] = useState<PolicyLetter[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [limitToCurrentMonth, setLimitToCurrentMonth] = useState(false);
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  const [loading, setLoading] = useState({
    clients: true,
    insurances: true,
    payments: true,
    providers: true,
    policies: true,
    countries: true,
    categories: true,
    subcategories: true,
    exchangeRates: true,
    users: true,
    paymentMethods: true,
    insuranceTypes: true,
    actionTypes: true,
    policyLetters: true,
    tasks: true,
  });

  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const refreshAll = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  useEffect(() => {
    if (!userId) {
      // Clear data when logged out
      setClients([]);
      setInsurances([]);
      setPayments([]);
      setProviders([]);
      setPolicies([]);
      setCountries([]);
      setCategories([]);
      setSubcategories([]);
      setExchangeRates([]);
      setUsers([]);
      setPaymentMethods([]);
      setInsuranceTypes([]);
      setActionTypes([]);
      setPolicyLetters([]);
      setTasks([]);
      setLoading({
        clients: false,
        insurances: false,
        payments: false,
        providers: false,
        policies: false,
        countries: false,
        categories: false,
        subcategories: false,
        exchangeRates: false,
        users: false,
        paymentMethods: false,
        insuranceTypes: false,
        actionTypes: false,
        policyLetters: false,
        tasks: false,
      });
      return;
    }

    if (quotaExceeded) {
      setLoading({
        clients: false,
        insurances: false,
        payments: false,
        providers: false,
        policies: false,
        countries: false,
        categories: false,
        subcategories: false,
        exchangeRates: false,
        users: false,
        paymentMethods: false,
        insuranceTypes: false,
        actionTypes: false,
        policyLetters: false,
        tasks: false,
      });
      return;
    }

    setLoading({
      clients: true,
      insurances: true,
      payments: true,
      providers: true,
      policies: true,
      countries: true,
      categories: true,
      subcategories: true,
      exchangeRates: true,
      users: true,
      paymentMethods: true,
      insuranceTypes: true,
      actionTypes: true,
      policyLetters: true,
      tasks: true,
    });

    const startOfCurrentMonth = new Date();
    startOfCurrentMonth.setDate(1);
    startOfCurrentMonth.setHours(0, 0, 0, 0);

    const qInsurances = limitToCurrentMonth
      ? query(collection(db, 'insurances'), where('createdAt', '>=', startOfCurrentMonth))
      : collection(db, 'insurances');

    const qPayments = limitToCurrentMonth
      ? query(collection(db, 'payments'), where('createdAt', '>=', startOfCurrentMonth))
      : collection(db, 'payments');

    const isQuotaError = (error: any) => {
      const errMsg = error instanceof Error ? error.message : String(error);
      const lower = errMsg.toLowerCase();
      return lower.includes('quota') || lower.includes('resource_exhausted') || lower.includes('limit exceeded') || lower.includes('quota exceeded');
    };

    const handleSubError = (error: any, collectionName: string) => {
      if (isQuotaError(error)) {
        console.warn(`Firestore Quota limit exceeded on ${collectionName}. Switching client database context to Offline Mode.`);
        setQuotaExceeded(true);
      } else {
        handleFirestoreError(error, OperationType.GET, collectionName);
      }
      setLoading(prev => ({ ...prev, [collectionName]: false }));
    };

    // Register SINGLE snapshot listeners for each core collection
    const unsubInsurances = onSnapshot(qInsurances, (snap) => {
      setInsurances(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsuranceRequest)));
      setLoading(prev => ({ ...prev, insurances: false }));
    }, (error) => {
      handleSubError(error, 'insurances');
    });

    const unsubPayments = onSnapshot(qPayments, (snap) => {
      setPayments(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Payment)));
      setLoading(prev => ({ ...prev, payments: false }));
    }, (error) => {
      handleSubError(error, 'payments');
    });

    const unsubRate = onSnapshot(query(collection(db, 'exchangeRates'), orderBy('date', 'desc'), limit(50)), (snap) => {
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setExchangeRates(list);
      if (list.length > 0) {
        setLatestExchangeRate((list[0] as any).rate || 18.0);
      }
      setLoading(prev => ({ ...prev, exchangeRates: false }));
    }, (error) => {
      handleSubError(error, 'exchangeRates');
    });

    const unsubCats = onSnapshot(query(collection(db, 'categories'), orderBy('name', 'asc')), (snap) => {
      setCategories(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category)));
      setLoading(prev => ({ ...prev, categories: false }));
    }, (error) => {
      handleSubError(error, 'categories');
    });

    const unsubSubs = onSnapshot(query(collection(db, 'subcategories'), orderBy('name', 'asc')), (snap) => {
      setSubcategories(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Subcategory)));
      setLoading(prev => ({ ...prev, subcategories: false }));
    }, (error) => {
      handleSubError(error, 'subcategories');
    });

    const unsubClients = onSnapshot(collection(db, 'clients'), (snap) => {
      setClients(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client)));
      setLoading(prev => ({ ...prev, clients: false }));
    }, (error) => {
      handleSubError(error, 'clients');
    });

    const unsubProviders = onSnapshot(collection(db, 'providers'), (snap) => {
      setProviders(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Provider)));
      setLoading(prev => ({ ...prev, providers: false }));
    }, (error) => {
      handleSubError(error, 'providers');
    });

    const unsubPolicies = onSnapshot(collection(db, 'policies'), (snap) => {
      setPolicies(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Policy)));
      setLoading(prev => ({ ...prev, policies: false }));
    }, (error) => {
      handleSubError(error, 'policies');
    });

    const unsubCountries = onSnapshot(collection(db, 'countries'), (snap) => {
      setCountries(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Country)));
      setLoading(prev => ({ ...prev, countries: false }));
    }, (error) => {
      handleSubError(error, 'countries');
    });

    const unsubTypes = onSnapshot(collection(db, 'insuranceTypes'), (snap) => {
      setInsuranceTypes(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(prev => ({ ...prev, insuranceTypes: false }));
    }, (error) => {
      handleSubError(error, 'insuranceTypes');
    });

    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
      setUsers(snap.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
      setLoading(prev => ({ ...prev, users: false }));
    }, (error) => {
      handleSubError(error, 'users');
    });

    const unsubPaymentMethods = onSnapshot(collection(db, 'paymentMethods'), (snap) => {
      setPaymentMethods(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(prev => ({ ...prev, paymentMethods: false }));
    }, (error) => {
      handleSubError(error, 'paymentMethods');
    });

    const unsubActionTypes = onSnapshot(query(collection(db, 'actionTypes'), orderBy('action')), (snap) => {
      setActionTypes(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
      setLoading(prev => ({ ...prev, actionTypes: false }));
    }, (error) => {
      handleSubError(error, 'actionTypes');
    });

    const unsubPolicyLetters = onSnapshot(collection(db, 'policyLetters'), (snap) => {
      setPolicyLetters(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as PolicyLetter)));
      setLoading(prev => ({ ...prev, policyLetters: false }));
    }, (error) => {
      handleSubError(error, 'policyLetters');
    });

    const unsubTasks = onSnapshot(collection(db, 'tasks'), (snap) => {
      setTasks(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task)));
      setLoading(prev => ({ ...prev, tasks: false }));
    }, (error) => {
      handleSubError(error, 'tasks');
    });

    return () => {
      unsubInsurances();
      unsubPayments();
      unsubRate();
      unsubCats();
      unsubSubs();
      unsubClients();
      unsubProviders();
      unsubPolicies();
      unsubCountries();
      unsubTypes();
      unsubUsers();
      unsubPaymentMethods();
      unsubActionTypes();
      unsubPolicyLetters();
      unsubTasks();
    };
  }, [userId, refreshTrigger, limitToCurrentMonth, quotaExceeded]);

  const isFullyLoaded = !loading.clients && !loading.insurances && !loading.policies;

  return (
    <FirestoreDataContext.Provider value={{
      clients,
      insurances,
      payments,
      providers,
      policies,
      countries,
      categories,
      subcategories,
      exchangeRates,
      latestExchangeRate,
      users,
      paymentMethods,
      insuranceTypes,
      actionTypes,
      policyLetters,
      tasks,
      loading,
      isFullyLoaded,
      refreshAll,
      limitToCurrentMonth,
      setLimitToCurrentMonth,
      quotaExceeded,
      setQuotaExceeded
    }}>
      {children}
    </FirestoreDataContext.Provider>
  );
}
