import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';

export function NotFoundPage() {
  return (
    <div className="min-h-screen grid place-items-center px-4 text-center">
      <div>
        <h1 className="text-6xl font-bold">404</h1>
        <p className="text-muted-foreground mt-2">This page doesn't exist.</p>
        <Link to="/"><Button className="mt-4">Back to dashboard</Button></Link>
      </div>
    </div>
  );
}
