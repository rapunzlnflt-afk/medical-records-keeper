import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex items-center justify-center min-h-[60vh] p-4">
      <Card className="max-w-sm w-full">
        <CardContent className="py-12 text-center">
          <FileQuestion className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
          <h2 className="font-heading text-lg font-bold mb-2">Page Not Found</h2>
          <p className="text-sm text-muted-foreground mb-4">The page you're looking for doesn't exist.</p>
          <Link href="/">
            <Button size="sm" className="gradient-primary text-white border-none">
              Back to Dashboard
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
