module pets.core

// possible attributes for OpenAPI events:
// paramaters - Object. query paramaters like petId
// data - Object. POST/PUT data
// config - Object. auth-headers, etc
workflow createPet {
    {pets/addPet {data createPet.data}}
}