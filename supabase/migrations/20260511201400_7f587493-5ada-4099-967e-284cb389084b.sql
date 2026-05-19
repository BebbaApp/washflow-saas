
-- Face enrollment (one current enrollment per user; history kept by keeping rows)
CREATE TABLE public.staff_face_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  image_url text NOT NULL,
  enrolled_by uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_face_enroll_user ON public.staff_face_enrollments(user_id) WHERE is_active;

ALTER TABLE public.staff_face_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own enrollment"
  ON public.staff_face_enrollments FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins manage enrollments insert"
  ON public.staff_face_enrollments FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins manage enrollments update"
  ON public.staff_face_enrollments FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins manage enrollments delete"
  ON public.staff_face_enrollments FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Attendance records
CREATE TABLE public.attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('check_in','check_out')),
  selfie_url text,
  match_score numeric,
  status text NOT NULL DEFAULT 'verified' CHECK (status IN ('verified','manual','rejected')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_attendance_user_time ON public.attendance_records(user_id, created_at DESC);
CREATE INDEX idx_attendance_time ON public.attendance_records(created_at DESC);

ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own attendance"
  ON public.attendance_records FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users insert own attendance"
  ON public.attendance_records FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins update attendance"
  ON public.attendance_records FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins delete attendance"
  ON public.attendance_records FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Storage bucket for selfies (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('attendance-selfies', 'attendance-selfies', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users read own selfies"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'attendance-selfies' AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR public.has_role(auth.uid(), 'admin'::app_role)
    )
  );

CREATE POLICY "Users upload own selfies"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'attendance-selfies' AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Admins delete selfies"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'attendance-selfies' AND public.has_role(auth.uid(), 'admin'::app_role)
  );
