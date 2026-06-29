--
-- PostgreSQL database dump
--

\restrict FYcKQRLWBA0vlAs9F847i9qUY2cwyd60yCTH53cYQWmIsFLI22x5NQfnyd7HwuS

-- Dumped from database version 17.10 (Debian 17.10-1.pgdg13+1)
-- Dumped by pg_dump version 17.10 (Debian 17.10-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: tarefa_pessoas; Type: TABLE DATA; Schema: public; Owner: assistente
--

INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('6940e351-787e-4cbe-acf6-0b91233080e3', '88ea8cff-086e-401e-ba6a-280ca96fa7e3', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('32606d54-a2f1-44ed-a78d-1ecc81e2a7ad', 'f6fc8430-f48d-4f66-9557-1e80bd862b73', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('ad71480a-cd54-463d-aad7-97cfeac3faba', '88ea8cff-086e-401e-ba6a-280ca96fa7e3', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('32606d54-a2f1-44ed-a78d-1ecc81e2a7ad', 'b7bde4f2-b770-490a-a4fa-cbc874a3f04d', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('f6d17b31-da34-43e7-8df4-74894ea0195a', 'bf0f09b2-6e01-42d9-bd8e-d201e4f913a8', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('32606d54-a2f1-44ed-a78d-1ecc81e2a7ad', 'b7aebe3f-fc2a-41de-aac8-b3f9cc6c63ba', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('5d5fcc9d-be9d-4f3c-ab49-884f5ae93cbf', 'f6fc8430-f48d-4f66-9557-1e80bd862b73', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('289cafb1-bde4-46a9-8ace-1db795bd5871', 'f6fc8430-f48d-4f66-9557-1e80bd862b73', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('967896ba-0930-4503-9c32-5f64e7d25f00', 'b7bde4f2-b770-490a-a4fa-cbc874a3f04d', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('967896ba-0930-4503-9c32-5f64e7d25f00', 'f6fc8430-f48d-4f66-9557-1e80bd862b73', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('a6928880-9858-4364-8016-3929124470eb', 'f6fc8430-f48d-4f66-9557-1e80bd862b73', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('a6928880-9858-4364-8016-3929124470eb', 'bf0f09b2-6e01-42d9-bd8e-d201e4f913a8', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('99113603-6c2a-4f8e-ace5-f94ec4b7ac6f', '2f82c920-9013-4993-a34b-12c3ccbdbe99', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('b37790d5-e786-449a-b062-363ae931c21a', 'd3112da9-a885-4d10-be32-0c6bd440ea0c', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('9a4f559e-d5b1-4844-a63a-f49ebb89605b', '88ea8cff-086e-401e-ba6a-280ca96fa7e3', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('9a4f559e-d5b1-4844-a63a-f49ebb89605b', 'f6fc8430-f48d-4f66-9557-1e80bd862b73', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('9a4f559e-d5b1-4844-a63a-f49ebb89605b', 'a8daede1-85fb-432f-aeba-e39a966e5d67', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('9a4f559e-d5b1-4844-a63a-f49ebb89605b', 'b7aebe3f-fc2a-41de-aac8-b3f9cc6c63ba', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('96aeb1ca-2e50-4fde-abec-7a73be777bea', 'a8daede1-85fb-432f-aeba-e39a966e5d67', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('96aeb1ca-2e50-4fde-abec-7a73be777bea', 'b7aebe3f-fc2a-41de-aac8-b3f9cc6c63ba', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('12b4d4a6-d68f-4fdc-82e5-6d0a65be1bbd', '9ade4da1-8b5f-4c1d-baef-c1d462871d8f', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('12b4d4a6-d68f-4fdc-82e5-6d0a65be1bbd', '88ea8cff-086e-401e-ba6a-280ca96fa7e3', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('12b4d4a6-d68f-4fdc-82e5-6d0a65be1bbd', '1ca0deea-5972-46e8-8fc7-f868f8c520a8', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('12b4d4a6-d68f-4fdc-82e5-6d0a65be1bbd', 'b7aebe3f-fc2a-41de-aac8-b3f9cc6c63ba', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('95fb25b7-9c3b-4d83-863c-38d1a96408b3', '5a5256c1-fa50-48a9-b2be-e8cc37329638', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('95fb25b7-9c3b-4d83-863c-38d1a96408b3', '971e22cb-2514-463a-9968-2ae6cddbdc9a', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('95fb25b7-9c3b-4d83-863c-38d1a96408b3', '5eb851f6-a9b6-4e2e-8d9e-210fdeb41853', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('90d0012a-328e-45bd-97dc-5d847ba18d95', '5eb851f6-a9b6-4e2e-8d9e-210fdeb41853', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('cc748e84-881c-49f7-a037-a9829be57feb', '052a5673-9c5c-4c7c-8c49-1c83e80f7851', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('cc748e84-881c-49f7-a037-a9829be57feb', '860f4862-e692-4563-a82a-357cef3e825c', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('ab43b48f-3f47-462a-82e8-d8e44861d120', 'f6fc8430-f48d-4f66-9557-1e80bd862b73', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('44d5b829-97c9-46d2-bb1e-22af2aa6a909', 'f6fc8430-f48d-4f66-9557-1e80bd862b73', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('3b8f94e0-4f6f-4399-9e09-1b78df9216f3', '88ea8cff-086e-401e-ba6a-280ca96fa7e3', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('3b8f94e0-4f6f-4399-9e09-1b78df9216f3', 'f6fc8430-f48d-4f66-9557-1e80bd862b73', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('12b4d4a6-d68f-4fdc-82e5-6d0a65be1bbd', 'f1d7d107-3afe-4f41-9c33-7b858303af72', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('12b4d4a6-d68f-4fdc-82e5-6d0a65be1bbd', 'b7bde4f2-b770-490a-a4fa-cbc874a3f04d', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('097b57c0-908d-4b7e-b33f-b879f6eb8998', 'f1d7d107-3afe-4f41-9c33-7b858303af72', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('097b57c0-908d-4b7e-b33f-b879f6eb8998', '88ea8cff-086e-401e-ba6a-280ca96fa7e3', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('b8914981-29ff-4cb2-b8a5-0aa3c54196b5', 'f1d7d107-3afe-4f41-9c33-7b858303af72', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('afa8e0fa-489c-4f67-b759-90bd40b62550', 'b7bde4f2-b770-490a-a4fa-cbc874a3f04d', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('afa8e0fa-489c-4f67-b759-90bd40b62550', 'b7aebe3f-fc2a-41de-aac8-b3f9cc6c63ba', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('afa8e0fa-489c-4f67-b759-90bd40b62550', '2a13588a-f38b-4763-b87c-9dffd3f6551d', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('5ededfb7-7f9c-49a7-8797-a64a9863cca0', 'b7bde4f2-b770-490a-a4fa-cbc874a3f04d', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('5ededfb7-7f9c-49a7-8797-a64a9863cca0', 'b7aebe3f-fc2a-41de-aac8-b3f9cc6c63ba', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('14f1ecf2-987b-4687-8125-af2b1c2d270b', 'b7bde4f2-b770-490a-a4fa-cbc874a3f04d', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('c54b21a9-d7b1-4c17-b7bc-74a125218f26', 'b7bde4f2-b770-490a-a4fa-cbc874a3f04d', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('c54b21a9-d7b1-4c17-b7bc-74a125218f26', 'b7aebe3f-fc2a-41de-aac8-b3f9cc6c63ba', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('3b26b683-18e1-4774-9596-107a3498193f', 'f6fc8430-f48d-4f66-9557-1e80bd862b73', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('3b26b683-18e1-4774-9596-107a3498193f', 'f87494a7-b00b-43f4-b51c-978bbb8ddb32', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('3b26b683-18e1-4774-9596-107a3498193f', '1ca0deea-5972-46e8-8fc7-f868f8c520a8', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('a907742e-b9e3-4b33-a8bb-2c1464b5349b', 'f6fc8430-f48d-4f66-9557-1e80bd862b73', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('a907742e-b9e3-4b33-a8bb-2c1464b5349b', 'ffbf7554-2dc7-47bb-9038-370b0390b4d2', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('a907742e-b9e3-4b33-a8bb-2c1464b5349b', '88ea8cff-086e-401e-ba6a-280ca96fa7e3', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('f0a5f48b-72d4-4b8c-b6fc-e8f89dda6689', 'f6fc8430-f48d-4f66-9557-1e80bd862b73', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('f0a5f48b-72d4-4b8c-b6fc-e8f89dda6689', 'ffbf7554-2dc7-47bb-9038-370b0390b4d2', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('f0a5f48b-72d4-4b8c-b6fc-e8f89dda6689', '88ea8cff-086e-401e-ba6a-280ca96fa7e3', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('3df6f800-5a2b-43bc-a818-fd15203877a8', 'f6fc8430-f48d-4f66-9557-1e80bd862b73', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('c54b21a9-d7b1-4c17-b7bc-74a125218f26', 'f6fc8430-f48d-4f66-9557-1e80bd862b73', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('d9cb2d27-c361-4449-9a67-354749b4f5c3', 'b7bde4f2-b770-490a-a4fa-cbc874a3f04d', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('d9cb2d27-c361-4449-9a67-354749b4f5c3', 'b7aebe3f-fc2a-41de-aac8-b3f9cc6c63ba', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('e8a207e1-6c28-4baf-ad3b-e54987aace48', 'b7bde4f2-b770-490a-a4fa-cbc874a3f04d', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('e8a207e1-6c28-4baf-ad3b-e54987aace48', 'f6fc8430-f48d-4f66-9557-1e80bd862b73', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('e8a207e1-6c28-4baf-ad3b-e54987aace48', '88ea8cff-086e-401e-ba6a-280ca96fa7e3', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('e8a207e1-6c28-4baf-ad3b-e54987aace48', 'b7aebe3f-fc2a-41de-aac8-b3f9cc6c63ba', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('c2c117ac-5c1b-4c3a-a2d1-f22caf780373', 'b7bde4f2-b770-490a-a4fa-cbc874a3f04d', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('6939ebb7-c715-4c61-8b15-524f36a60748', '88ea8cff-086e-401e-ba6a-280ca96fa7e3', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('6939ebb7-c715-4c61-8b15-524f36a60748', 'f6fc8430-f48d-4f66-9557-1e80bd862b73', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('6939ebb7-c715-4c61-8b15-524f36a60748', '9ba206d2-0ede-4f63-a670-20b4d64a43f8', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('6939ebb7-c715-4c61-8b15-524f36a60748', 'b1787309-e9c5-4aca-bf1d-0465bdf3c53f', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('6939ebb7-c715-4c61-8b15-524f36a60748', '5eb851f6-a9b6-4e2e-8d9e-210fdeb41853', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('ab49a2e7-dcd5-4d09-a2b2-33d3f272436e', 'f6fc8430-f48d-4f66-9557-1e80bd862b73', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('ab49a2e7-dcd5-4d09-a2b2-33d3f272436e', '88ea8cff-086e-401e-ba6a-280ca96fa7e3', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('7d54f5d2-ef93-48f2-98a2-8add7c4f2b79', 'f6fc8430-f48d-4f66-9557-1e80bd862b73', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('7d54f5d2-ef93-48f2-98a2-8add7c4f2b79', '5eb851f6-a9b6-4e2e-8d9e-210fdeb41853', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('7d54f5d2-ef93-48f2-98a2-8add7c4f2b79', 'f6afb0a1-e3f9-47fb-8aad-2e88803536a0', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('7d54f5d2-ef93-48f2-98a2-8add7c4f2b79', '88ea8cff-086e-401e-ba6a-280ca96fa7e3', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('a48c598b-e906-4563-b13c-7ff741b71b0d', '9ba206d2-0ede-4f63-a670-20b4d64a43f8', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('a48c598b-e906-4563-b13c-7ff741b71b0d', 'b1787309-e9c5-4aca-bf1d-0465bdf3c53f', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('a48c598b-e906-4563-b13c-7ff741b71b0d', 'f6fc8430-f48d-4f66-9557-1e80bd862b73', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('a48c598b-e906-4563-b13c-7ff741b71b0d', '88ea8cff-086e-401e-ba6a-280ca96fa7e3', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('a48c598b-e906-4563-b13c-7ff741b71b0d', '5eb851f6-a9b6-4e2e-8d9e-210fdeb41853', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('a48c598b-e906-4563-b13c-7ff741b71b0d', '57bb5853-0dae-425e-a1ae-f31982f7c212', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('3aa43e8a-0b18-4fb8-8e6b-91c56fbcc9e4', 'b7bde4f2-b770-490a-a4fa-cbc874a3f04d', true);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('3aa43e8a-0b18-4fb8-8e6b-91c56fbcc9e4', '1ca0deea-5972-46e8-8fc7-f868f8c520a8', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('3aa43e8a-0b18-4fb8-8e6b-91c56fbcc9e4', 'b7aebe3f-fc2a-41de-aac8-b3f9cc6c63ba', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('3aa43e8a-0b18-4fb8-8e6b-91c56fbcc9e4', 'f6fc8430-f48d-4f66-9557-1e80bd862b73', false);
INSERT INTO public.tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ('3aa43e8a-0b18-4fb8-8e6b-91c56fbcc9e4', '88ea8cff-086e-401e-ba6a-280ca96fa7e3', false);


--
-- PostgreSQL database dump complete
--

\unrestrict FYcKQRLWBA0vlAs9F847i9qUY2cwyd60yCTH53cYQWmIsFLI22x5NQfnyd7HwuS

