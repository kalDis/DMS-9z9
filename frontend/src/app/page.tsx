'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const token = localStorage.getItem('dms_token');
    router.push(token ? '/dashboard' : '/login');
  }, [router]);
  return null;
}
