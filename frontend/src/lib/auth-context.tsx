'use client';
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from './api';

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  must_change_password?: boolean;
}

interface Business {
  id: number;
  name: string;
}

interface AuthContextType {
  user: User | null;
  businesses: Business[];
  activeBusiness: Business | null;
  setActiveBusiness: (b: Business) => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [activeBusiness, setActiveBusinessState] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('dms_token');
    const savedUser = localStorage.getItem('dms_user');
    if (token && savedUser) {
      const u = JSON.parse(savedUser);
      setUser(u);
      api('/auth/me').then(data => {
        setBusinesses(data.businesses);
        const saved = localStorage.getItem('dms_active_business');
        if (saved) {
          const sb = JSON.parse(saved);
          const found = data.businesses.find((b: Business) => b.id === sb.id);
          setActiveBusinessState(found || data.businesses[0] || null);
        } else {
          setActiveBusinessState(data.businesses[0] || null);
        }
      }).catch(() => {
        localStorage.removeItem('dms_token');
        localStorage.removeItem('dms_user');
        setUser(null);
      }).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email: string, password: string) => {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    localStorage.setItem('dms_token', data.token);
    localStorage.setItem('dms_user', JSON.stringify(data.user));
    setUser(data.user);
    setBusinesses(data.businesses);
    setActiveBusinessState(data.businesses[0] || null);
  };

  const logout = () => {
    localStorage.removeItem('dms_token');
    localStorage.removeItem('dms_user');
    localStorage.removeItem('dms_active_business');
    setUser(null);
    setBusinesses([]);
    setActiveBusinessState(null);
  };

  const setActiveBusiness = (b: Business) => {
    setActiveBusinessState(b);
    localStorage.setItem('dms_active_business', JSON.stringify(b));
  };

  return (
    <AuthContext.Provider value={{ user, businesses, activeBusiness, setActiveBusiness, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
