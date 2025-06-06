import { Column, Entity, PrimaryGeneratedColumn } from "typeorm"
import { defaultDataSource } from "./resolvers/sqldb/database.js"

@Entity()
export class User {
    @PrimaryGeneratedColumn()
    id: number = 0

    @Column()
    firstName: string = ''

    @Column()
    lastName: string = ''

    @Column()
    isActive: boolean = true
}

export async function CreateTestEntities() {
    if (defaultDataSource) {
        const userRepository = defaultDataSource.getRepository(User)
        const user = new User()
        user.firstName = "Timber"
        user.lastName = "Saw"
        await userRepository.save(user)

        const allUsers = await userRepository.find()
        console.log(allUsers)
        const firstUser = await userRepository.findOneBy({
            id: 1,
        })
        console.log(firstUser)
        const timber = await userRepository.findOneBy({
            firstName: "Timber",
            lastName: "Saw"
        })
        console.log(timber)
    }
}