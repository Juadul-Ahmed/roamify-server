import dns from "node:dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]);

import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ObjectId, Collection, Document } from "mongodb";

dotenv.config();

// ── DOMAIN TYPES 

export type UserRole = "traveler" | "organizer" | "admin";

export interface UserDoc extends Document {
  _id: ObjectId;
  name: string;
  email: string;
  role: UserRole;
  emailVerified?: boolean;
  createdAt: Date;
  updatedAt?: Date;
}

export interface SessionDoc extends Document {
  _id: ObjectId;
  token: string;
  userId: string;
  expiresAt?: Date | string;
}

export interface TourDoc extends Document {
  _id?: ObjectId;
  title: string;
  location: string;
  price: number;
  category: string;
  description: string;
  image: string;
  rating: number;
  organizerId: string;
  organizerName: string;
  createdAt: Date;
  updatedAt: Date;
}

export type BookingStatus = "pending" | "confirmed" | "cancelled";

export interface BookingDoc extends Document {
  _id?: ObjectId;
  tourId: string;
  tourTitle: string;
  tourImage: string;
  organizerId: string;
  userId: string;
  userName: string;
  userEmail: string;
  guests: number;
  date: Date;
  pricePerPerson: number;
  totalPrice: number;
  status: BookingStatus;
  createdAt: Date;
  updatedAt: Date;
}

declare global {

  namespace Express {
    interface Request {
      user?: UserDoc;
    }
  }
}

// ── APP SETUP 

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

if (!process.env.MONGO_DB_URI) {
  throw new Error("MONGO_DB_URI environment variable is missing inside your .env configuration.");
}

const client = new MongoClient(process.env.MONGO_DB_URI);
const dbName = process.env.DB_NAME || "roamify";
const db = client.db(dbName);

const toursCollection: Collection<TourDoc> = db.collection<TourDoc>("tours");
const usersCollection: Collection<UserDoc> = db.collection<UserDoc>("user");
const bookingsCollection: Collection<BookingDoc> = db.collection<BookingDoc>("bookings");
const sessionCollection: Collection<SessionDoc> = db.collection<SessionDoc>("session");

// ── AUTH MIDDLEWARE 

const verifyToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers?.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized — no token provided." });
      return;
    }

    const token = authHeader.split(" ")[1];

    const session = await sessionCollection.findOne({ token });
    if (!session) {
      res.status(401).json({ error: "Unauthorized — invalid or expired session." });
      return;
    }

    if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
      res.status(401).json({ error: "Unauthorized — session expired." });
      return;
    }

    const user = await usersCollection.findOne({ _id: new ObjectId(session.userId) });
    if (!user) {
      res.status(401).json({ error: "Unauthorized — user not found." });
      return;
    }

    req.user = user;
    next();
  } catch (err) {
    console.error("verifyToken error:", err);
    res.status(500).json({ error: "Internal server error during authentication." });
  }
};

const verifyRole = (allowedRoles: UserRole | UserRole[]) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "Forbidden — you don't have permission for this action." });
      return;
    }
    next();
  };

app.get("/", (req: Request, res: Response) => {
  res.send("Hello World!");
});

// ── TOURS 

interface CreateTourBody {
  title: string;
  location: string;
  price: number | string;
  category: string;
  description: string;
  image: string;
}

app.post(
  "/tours",
  verifyToken,
  verifyRole(["organizer", "admin"]),
  async (req: Request<unknown, unknown, CreateTourBody>, res: Response) => {
    try {
      const { title, location, price, category, description, image } = req.body;

      if (!title || !location || !price || !category || !description || !image) {
        return res.status(400).json({ error: "All fields are required." });
      }

      const tour: TourDoc = {
        title,
        location,
        price: Number(price),
        category,
        description,
        image,
        rating: 0,
        organizerId: req.user!._id.toString(),
        organizerName:
          req.user!.role === "admin" ? `${req.user!.name} (Admin)` : req.user!.name,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await toursCollection.insertOne(tour);

      res.status(201).json({ message: "Tour created successfully.", tourId: result.insertedId });
    } catch (err) {
      console.error("Error creating tour:", err);
      res.status(500).json({ error: "Something went wrong on our end." });
    }
  }
);

interface TourQuery {
  organizerId?: string;
  search?: string;
  category?: string;
  sort?: string;
  page?: string;
  limit?: string;
}

app.get("/tours", async (req: Request<unknown, unknown, unknown, TourQuery>, res: Response) => {
  try {
    const { organizerId, search, category, sort, page = "1", limit = "6" } = req.query;

    const query: Record<string, unknown> = {};
    if (organizerId) query.organizerId = organizerId;
    if (category && category !== "All") query.category = category;
    if (search) {
      const regex = { $regex: String(search), $options: "i" };
      query.$or = [{ title: regex }, { location: regex }];
    }

    let sortSpec: Record<string, 1 | -1> = { createdAt: -1 };
    if (sort === "price_asc") sortSpec = { price: 1 };
    else if (sort === "price_desc") sortSpec = { price: -1 };

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 6);
    const skip = (pageNum - 1) * limitNum;

    const [tours, totalCount] = await Promise.all([
      toursCollection.find(query).sort(sortSpec).skip(skip).limit(limitNum).toArray(),
      toursCollection.countDocuments(query),
    ]);

    res.status(200).json({
      tours,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalCount,
        totalPages: Math.ceil(totalCount / limitNum) || 1,
      },
    });
  } catch (err) {
    console.error("Error fetching tours:", err);
    res.status(500).json({ error: "Something went wrong on our end." });
  }
});

app.get("/tours/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid tour id." });

    const tour = await toursCollection.findOne({ _id: new ObjectId(id) });
    if (!tour) return res.status(404).json({ error: "Tour not found." });

    res.status(200).json({ tour });
  } catch (err) {
    console.error("Error fetching tour:", err);
    res.status(500).json({ error: "Something went wrong on our end." });
  }
});

app.patch(
  "/tours/:id",
  verifyToken,
  verifyRole(["organizer", "admin"]),
  async (req: Request<{ id: string }, unknown, CreateTourBody>, res: Response) => {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid tour id." });

      const existingTour = await toursCollection.findOne({ _id: new ObjectId(id) });
      if (!existingTour) return res.status(404).json({ error: "Tour not found." });

      if (req.user!.role === "organizer" && existingTour.organizerId !== req.user!._id.toString()) {
        return res.status(403).json({ error: "You can only edit your own tours." });
      }

      const { title, location, price, category, description, image } = req.body;
      if (!title || !location || !price || !category || !description || !image) {
        return res.status(400).json({ error: "All fields are required." });
      }

      const result = await toursCollection.findOneAndUpdate(
        { _id: new ObjectId(id) },
        {
          $set: {
            title,
            location,
            price: Number(price),
            category,
            description,
            image,
            updatedAt: new Date(),
          },
        },
        { returnDocument: "after" }
      );

      res.status(200).json({ message: "Tour updated successfully.", tour: result });
    } catch (err) {
      console.error("Error updating tour:", err);
      res.status(500).json({ error: "Something went wrong on our end." });
    }
  }
);

app.delete(
  "/tours/:id",
  verifyToken,
  verifyRole(["organizer", "admin"]),
  async (req: Request<{ id: string }>, res: Response) => {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid tour id." });

      const existingTour = await toursCollection.findOne({ _id: new ObjectId(id) });
      if (!existingTour) return res.status(404).json({ error: "Tour not found." });

      if (req.user!.role === "organizer" && existingTour.organizerId !== req.user!._id.toString()) {
        return res.status(403).json({ error: "You can only delete your own tours." });
      }

      await toursCollection.deleteOne({ _id: new ObjectId(id) });
      res.status(200).json({ message: "Tour deleted successfully." });
    } catch (err) {
      console.error("Error deleting tour:", err);
      res.status(500).json({ error: "Something went wrong on our end." });
    }
  }
);

// ── BOOKINGS 

interface CreateBookingBody {
  tourId: string;
  guests: number | string;
  date: string;
}

app.post(
  "/bookings",
  verifyToken,
  verifyRole("traveler"),
  async (req: Request<unknown, unknown, CreateBookingBody>, res: Response) => {
    try {
      const { tourId, guests, date } = req.body;

      if (!tourId || !guests || !date) {
        return res.status(400).json({ error: "tourId, guests, and date are required." });
      }
      if (!ObjectId.isValid(tourId)) return res.status(400).json({ error: "Invalid tour id." });

      const tour = await toursCollection.findOne({ _id: new ObjectId(tourId) });
      if (!tour) return res.status(404).json({ error: "Tour not found." });

      const guestCount = Number(guests);
      if (!Number.isInteger(guestCount) || guestCount < 1) {
        return res.status(400).json({ error: "Guests must be a positive whole number." });
      }

      const booking: BookingDoc = {
        tourId,
        tourTitle: tour.title,
        tourImage: tour.image,
        organizerId: tour.organizerId,
        userId: req.user!._id.toString(),
        userName: req.user!.name,
        userEmail: req.user!.email,
        guests: guestCount,
        date: new Date(date),
        pricePerPerson: tour.price,
        totalPrice: tour.price * guestCount,
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await bookingsCollection.insertOne(booking);
      res.status(201).json({ message: "Booking created successfully.", bookingId: result.insertedId });
    } catch (err) {
      console.error("Error creating booking:", err);
      res.status(500).json({ error: "Something went wrong on our end." });
    }
  }
);

interface UpdateBookingStatusBody {
  status: BookingStatus;
}

app.patch(
  "/bookings/:id/status",
  verifyToken,
  verifyRole(["organizer", "admin"]),
  async (req: Request<{ id: string }, unknown, UpdateBookingStatusBody>, res: Response) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      if (!ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid booking id." });

      const allowedStatuses: BookingStatus[] = ["pending", "confirmed", "cancelled"];
      if (!allowedStatuses.includes(status)) return res.status(400).json({ error: "Invalid status." });

      const existingBooking = await bookingsCollection.findOne({ _id: new ObjectId(id) });
      if (!existingBooking) return res.status(404).json({ error: "Booking not found." });

      if (req.user!.role === "organizer" && existingBooking.organizerId !== req.user!._id.toString()) {
        return res.status(403).json({ error: "You can only manage bookings on your own tours." });
      }

      const result = await bookingsCollection.findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: { status, updatedAt: new Date() } },
        { returnDocument: "after" }
      );

      res.status(200).json({ message: "Booking status updated.", booking: result });
    } catch (err) {
      console.error("Error updating booking status:", err);
      res.status(500).json({ error: "Something went wrong on our end." });
    }
  }
);

app.get(
  "/organizer/stats",
  verifyToken,
  verifyRole("organizer"),
  async (req: Request, res: Response) => {
    try {
      const organizerId = req.user!._id.toString();

      const tours = await toursCollection.find({ organizerId }).toArray();
      const bookings = await bookingsCollection.find({ organizerId }).toArray();

      const totalTours = tours.length;
      const totalBookings = bookings.length;
      const totalRevenue = bookings
        .filter((b) => b.status !== "cancelled")
        .reduce((sum, b) => sum + (b.totalPrice || 0), 0);

      const ratedTours = tours.filter((t) => typeof t.rating === "number" && t.rating > 0);
      const averageRating =
        ratedTours.length > 0
          ? ratedTours.reduce((sum, t) => sum + t.rating, 0) / ratedTours.length
          : 0;

      res.status(200).json({ stats: { totalTours, totalBookings, totalRevenue, averageRating } });
    } catch (err) {
      console.error("Error fetching organizer stats:", err);
      res.status(500).json({ error: "Something went wrong on our end." });
    }
  }
);

interface BookingsQuery {
  userId?: string;
  organizerId?: string;
}

app.get("/bookings", verifyToken, async (req: Request<unknown, unknown, unknown, BookingsQuery>, res: Response) => {
  try {
    let query: Record<string, string>;

    if (req.user!.role === "admin") {
      const { userId, organizerId } = req.query;
      query = userId ? { userId } : organizerId ? { organizerId } : {};
    } else if (req.user!.role === "organizer") {
      query = { organizerId: req.user!._id.toString() };
    } else {
      query = { userId: req.user!._id.toString() };
    }

    const bookings = await bookingsCollection.find(query).sort({ createdAt: -1 }).toArray();
    res.status(200).json({ bookings });
  } catch (err) {
    console.error("Error fetching bookings:", err);
    res.status(500).json({ error: "Something went wrong on our end." });
  }
});

app.delete("/bookings/:id", verifyToken, async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid booking id." });

    const existingBooking = await bookingsCollection.findOne({ _id: new ObjectId(id) });
    if (!existingBooking) return res.status(404).json({ error: "Booking not found." });

    const isOwner = existingBooking.userId === req.user!._id.toString();
    if (!isOwner && req.user!.role !== "admin") {
      return res.status(403).json({ error: "You can only cancel your own bookings." });
    }

    await bookingsCollection.deleteOne({ _id: new ObjectId(id) });
    res.status(200).json({ message: "Booking cancelled successfully." });
  } catch (err) {
    console.error("Error cancelling booking:", err);
    res.status(500).json({ error: "Something went wrong on our end." });
  }
});

// ── ADMIN ROUTES 

app.get("/admin/stats", verifyToken, verifyRole("admin"), async (req: Request, res: Response) => {
  try {
    const [totalUsers, totalOrganizers, totalTravelers, totalTours, allBookings] = await Promise.all([
      usersCollection.countDocuments({}),
      usersCollection.countDocuments({ role: "organizer" }),
      usersCollection.countDocuments({ role: "traveler" }),
      toursCollection.countDocuments({}),
      bookingsCollection.find({}).toArray(),
    ]);

    const totalBookings = allBookings.length;
    const totalRevenue = allBookings
      .filter((b) => b.status !== "cancelled")
      .reduce((sum, b) => sum + (b.totalPrice || 0), 0);

    res.status(200).json({
      stats: { totalUsers, totalOrganizers, totalTravelers, totalTours, totalBookings, totalRevenue },
    });
  } catch (err) {
    console.error("Error fetching admin stats:", err);
    res.status(500).json({ error: "Something went wrong on our end." });
  }
});

interface AdminUsersQuery {
  search?: string;
  role?: string;
}

app.get(
  "/admin/users",
  verifyToken,
  verifyRole("admin"),
  async (req: Request<unknown, unknown, unknown, AdminUsersQuery>, res: Response) => {
    try {
      const { search, role } = req.query;
      const query: Record<string, unknown> = {};
      if (role && role !== "All") query.role = role;
      if (search) {
        const regex = { $regex: String(search), $options: "i" };
        query.$or = [{ name: regex }, { email: regex }];
      }

      const users = await usersCollection
        .find(query)
        .sort({ createdAt: -1 })
        .project({ name: 1, email: 1, role: 1, createdAt: 1, emailVerified: 1 })
        .toArray();

      res.status(200).json({ users });
    } catch (err) {
      console.error("Error fetching users:", err);
      res.status(500).json({ error: "Something went wrong on our end." });
    }
  }
);

interface UpdateRoleBody {
  role: UserRole;
}

app.patch(
  "/admin/users/:id/role",
  verifyToken,
  verifyRole("admin"),
  async (req: Request<{ id: string }, unknown, UpdateRoleBody>, res: Response) => {
    try {
      const { id } = req.params;
      const { role } = req.body;
      if (!ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid user id." });

      const allowedRoles: UserRole[] = ["traveler", "organizer", "admin"];
      if (!allowedRoles.includes(role)) return res.status(400).json({ error: "Invalid role." });

      const result = await usersCollection.findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: { role, updatedAt: new Date() } },
        { returnDocument: "after" }
      );

      if (!result) return res.status(404).json({ error: "User not found." });
      res.status(200).json({ message: "Role updated successfully.", user: result });
    } catch (err) {
      console.error("Error updating user role:", err);
      res.status(500).json({ error: "Something went wrong on our end." });
    }
  }
);

app.delete("/admin/users/:id", verifyToken, verifyRole("admin"), async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid user id." });

    const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) return res.status(404).json({ error: "User not found." });

    res.status(200).json({ message: "User deleted successfully." });
  } catch (err) {
    console.error("Error deleting user:", err);
    res.status(500).json({ error: "Something went wrong on our end." });
  }
});

app.get("/admin/analytics", verifyToken, verifyRole("admin"), async (req: Request, res: Response) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const signupsByDay = await usersCollection
      .aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    const revenueByDay = await bookingsCollection
      .aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo }, status: { $ne: "cancelled" } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            revenue: { $sum: "$totalPrice" },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    const roleDistribution = await usersCollection
      .aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }])
      .toArray();

    const bookingStatusBreakdown = await bookingsCollection
      .aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }])
      .toArray();

    res.status(200).json({ signupsByDay, revenueByDay, roleDistribution, bookingStatusBreakdown });
  } catch (err) {
    console.error("Error fetching admin analytics:", err);
    res.status(500).json({ error: "Something went wrong on our end." });
  }
});

async function startServer(): Promise<void> {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    app.listen(port, () => {
      console.log(`Example app listening on port ${port}`);
    });
  } catch (err) {
    console.error("Failed to connect to MongoDB:", err);
    process.exit(1);
  }
}

startServer();